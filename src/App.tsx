import { useEffect, useRef, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { TimeEntry, TaskTag, EntryListItem, EntryFullItem } from "./types";
import {
  initSchema,
  initSearch,
  resetDbCaches,
  getDbPathInfo,
  backupNow,
} from "./db/client";
import {
  listTags,
  newEntry,
  deleteEntry,
  getEntry,
  getLastEntryDate,
} from "./db/repository";
import { applyTheme, getStoredTheme, watchSystemTheme } from "./lib/theme";
import { toUserMessage } from "./lib/errors";
import { formatDateDe, todayIso } from "./lib/calendar";
import { secondaryBtnCls } from "./lib/ui";
import {
  type StartMode,
  getStartStatus,
  getAutoLockMinutes,
  startIdleTimer,
  lock,
} from "./lib/auth";
import Sidebar, { type View } from "./components/Sidebar";
import QuickEntryView, { clearQuickEntryDraft } from "./views/QuickEntryView";
import HistoryView from "./views/HistoryView";
import StatsView from "./views/StatsView";
import DataView from "./views/DataView";
import LockScreen from "./views/LockScreen";
import EntryForm from "./components/EntryForm";
import EntryDetail from "./components/EntryDetail";

type Modal =
  | { type: "form"; entry: TimeEntry }
  | { type: "detail"; entry: EntryFullItem }
  | null;

/**
 * Fokussiert beim Öffnen das erste fokussierbare Element im Dialog-Container
 * und hält Tab/Shift+Tab innerhalb des Dialogs (Fokusfalle). Ohne das springt
 * der Tastaturfokus beim Tabben aus dem Modal in den verdeckten Hintergrund --
 * für Tastatur-/Screenreader-Nutzer ist der Dialog dann kaum bedienbar
 * (Finding 41: Modal ohne role="dialog"/aria-modal und ohne Fokusfalle).
 */
function useModalFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  // Finding B5: ohne explizite Zielangabe fokussiert die Falle blind das
  // ERSTE fokussierbare Element im Container -- im Bearbeiten-Modal kann das
  // z. B. der "Übernehmen"-Hinweis-Button (showLastDefaultsHint) VOR dem
  // Datumsfeld sein und damit den seit W1 vorgesehenen Autofokus auf das
  // Datumsfeld unterlaufen. initialFocusRef erlaubt es dem Aufrufer, das
  // tatsächlich gewünschte Ziel vorzugeben; ohne Angabe bleibt das bisherige
  // Verhalten (erstes fokussierbares Element) unverändert.
  initialFocusRef?: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));

    const first = initialFocusRef?.current ?? focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [ref, active, initialFocusRef]);
}

export default function App() {
  const [startMode, setStartMode] = useState<"loading" | StartMode>("loading");
  const [startMessage, setStartMessage] = useState<string | undefined>();
  const [locked, setLocked] = useState(true); // gesperrt bis Setup/Migration/Unlock
  const [ready, setReady] = useState(false); // DB entsperrt + Schema initialisiert
  const [initError, setInitError] = useState<string | null>(null);
  const [initDbPath, setInitDbPath] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [autoLockMin, setAutoLockMin] = useState(5);
  const [view, setView] = useState<View>("erfassen");
  const [tags, setTags] = useState<TaskTag[]>([]);
  // Für Formulare zusätzlich inkl. archivierter Tags: einem Eintrag bereits
  // zugewiesene, inzwischen archivierte Schlagwörter müssen dort sichtbar und
  // entfernbar bleiben (siehe EntryForm). Historie/Filter nutzen weiter `tags`
  // (nur aktive) – unverändert.
  const [allTags, setAllTags] = useState<TaskTag[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [quickEntryDirty, setQuickEntryDirty] = useState(false);
  // Confirm-Dialog für sowohl "ungespeicherte Eingaben verwerfen" als auch
  // "Eintrag löschen" (Finding 2): confirmLabel unterscheidet die Beschriftung
  // des destruktiven Buttons, Aufbau/Optik des Dialogs bleibt identisch.
  const [confirmDiscard, setConfirmDiscard] = useState<{
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Erinnerung bei fehlender Erfassung (Finding 31).
  const [lastEntryDate, setLastEntryDate] = useState<string | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  const bump = () => setReloadKey((k) => k + 1);
  // Finding 22: loadTags/loadAllTags wurden an mehreren Stellen ohne catch
  // aufgerufen (u. a. aus DataView.onChanged nach Import/Tag-Änderung) --
  // der catch sitzt hier zentral, damit jeder Aufrufer automatisch geschützt ist.
  const loadTags = () =>
    listTags()
      .then(setTags)
      .catch((e) => showToast(toUserMessage(e)));
  const loadAllTags = () =>
    listTags(true)
      .then(setAllTags)
      .catch((e) => showToast(toUserMessage(e)));

  // Finding 54: showToast setzte bei jedem Aufruf einen neuen Timer, ohne
  // einen vorherigen zu clearen -- zwei Toasts innerhalb von 2,5 s ließen den
  // ersten Timer den zweiten Toast vorzeitig ausblenden.
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (m: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(m);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2500);
  };
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  // Fokusfallen für die beiden Dialoge (Finding 41), siehe useModalFocusTrap oben.
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  // Finding B5: Ziel-Ref für den Autofokus im Bearbeiten-Modal (Datumsfeld),
  // wird nur bei modal.type === "form" an useModalFocusTrap durchgereicht --
  // die Detailansicht behält das bisherige Verhalten (erstes fokussierbares
  // Element).
  const dateFieldRef = useRef<HTMLInputElement>(null);
  useModalFocusTrap(
    modalRef,
    !!modal,
    modal?.type === "form" ? dateFieldRef : undefined
  );
  useModalFocusTrap(confirmRef, !!confirmDiscard);

  // Theme anwenden (FOUC-Script hat die Klasse bereits gesetzt; hier zusätzlich
  // das native Fenster-Theme synchronisieren und auf OS-Wechsel reagieren).
  useEffect(() => {
    applyTheme(getStoredTheme());
    return watchSystemTheme(() => {
      if (getStoredTheme() === "system") applyTheme("system");
    });
  }, []);

  // Startentscheidung: firstRun / needsMigration / encrypted / error.
  useEffect(() => {
    (async () => {
      try {
        const s = await getStartStatus();
        setAutoLockMin(s.autoLockMinutes);
        setStartMessage(s.message);
        setStartMode(s.mode);
      } catch (e) {
        setStartMessage(toUserMessage(e));
        setStartMode("error");
      }
    })();
  }, []);

  // Nach erfolgreichem Entsperren/Einrichten: neue keyed Connection -> Schema
  // frisch initialisieren, dann App freigeben.
  const handleUnlocked = async () => {
    try {
      resetDbCaches();
      await initSchema();
      await initSearch();
      await loadTags();
      await loadAllTags();
      setAutoLockMin(await getAutoLockMinutes());
      setInitError(null);
      setReady(true);
      setStartMode("encrypted"); // ab jetzt ist die DB verschlüsselt -> Unlock
      setLocked(false);
      // Automatisches Sicherheits-Backup NACH erfolgreichem Entsperren
      // (Finding 5): best-effort, blockiert den Start nicht. Schutz gegen
      // Fehlbedienung/Plattenausfall -- ein Fehlschlag wird nur geloggt +
      // dezent als Toast gemeldet, nicht als harter Fehler behandelt.
      void backupNow().catch((e) => {
        console.warn("Automatisches Backup fehlgeschlagen.", e);
        showToast("Automatisches Backup fehlgeschlagen (siehe Konsole).");
      });
    } catch (e) {
      setInitError(toUserMessage(e));
      setLocked(false); // raus aus dem LockScreen, Fehler anzeigen
    }
  };

  // Fehlerscreen: DB-Pfad best effort nachladen (für die Recovery-Hinweise).
  useEffect(() => {
    if (!initError) return;
    let active = true;
    getDbPathInfo()
      .then((info) => {
        if (active) setInitDbPath(info.dbFile);
      })
      .catch(() => {
        /* Pfad ist nur eine Zusatzinfo – ohne ihn zeigen wir den Rest an. */
      });
    return () => {
      active = false;
    };
  }, [initError]);

  // Erneuter Init-Versuch nach einem (evtl. transienten) Startfehler. Die
  // Init-Caches werden in handleUnlocked zurückgesetzt; ein abgelehntes Promise
  // wird nicht dauerhaft gecacht, ein Retry kann also durchlaufen.
  const retryInit = async () => {
    setRetrying(true);
    setInitError(null);
    await handleUnlocked();
    setRetrying(false);
  };

  // Erinnerung bei fehlender Erfassung (Finding 31): rein lokaler Hinweis,
  // kein Cloud-/Notification-Dienst. Lädt nach dem Entsperren und bei jeder
  // Datenänderung (reloadKey) das Datum des jüngsten Eintrags nach; die
  // eigentliche Anzeige-Schwelle steckt im showReminder-Ausdruck unten.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    getLastEntryDate()
      .then((d) => {
        if (active) setLastEntryDate(d);
      })
      .catch(() => {
        /* Erinnerung ist nur ein Komfort-Hinweis, kein Fehlerfall. */
      });
    return () => {
      active = false;
    };
  }, [ready, reloadKey]);

  // Sperren: Rust verwirft Schlüssel + Connection; UI zurück zum LockScreen.
  const doLock = () => {
    void lock().finally(() => {
      setReady(false);
      setLocked(true);
    });
  };

  // Auto-Lock bei Inaktivität (Pflicht) + Sperren, sobald die App nicht mehr
  // sichtbar ist. Linux-Portierung (L3): ersetzt den bisherigen Windows-
  // spezifischen Weg über @tauri-apps/api/window (onResized + isMinimized,
  // das unter WebKitGTK/Linux nicht zuverlässig dieselben Ereignisse liefert)
  // durch die plattformneutrale Page-Visibility-API. document.hidden wird
  // true bei Minimieren, Tab-/Fenster-Wechsel, Bildschirmsperre -- unter
  // Windows, Linux und später Android gleichermaßen, ganz ohne
  // fenster-spezifisches Tauri-Plugin. Bewusst OHNE Gnadenfrist: Sperren
  // erfolgt sofort beim Verstecken. Eine Grace-Periode von ~5 s wäre Plan B,
  // falls sich das in der Praxis (z. B. kurzes Alt-Tab) als zu aggressiv
  // erweist -- bis dahin gilt die strengere, sicherere Variante.
  useEffect(() => {
    if (!ready || locked) return;
    const stopIdle = startIdleTimer(autoLockMin, doLock);
    const onVisibilityChange = () => {
      if (document.hidden) doLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopIdle();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ready, locked, autoLockMin]);

  const openNew = (iso?: string) => {
    setFormDirty(false);
    setModal({ type: "form", entry: newEntry(iso ?? todayIso()) });
  };
  // Detailansicht öffnet den Eintrag VOLLSTÄNDIG (Refetch inkl. secretDetails);
  // Listen-Items tragen das vertrauliche Feld bewusst nicht mehr.
  const openDetail = async (entry: EntryListItem) => {
    try {
      const full = await getEntry(entry.id);
      if (!full) {
        showToast("Eintrag nicht gefunden");
        bump();
        return;
      }
      setModal({ type: "detail", entry: full });
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };

  const handleModalSaved = () => {
    setModal(null);
    setFormDirty(false);
    bump();
    showToast("Eintrag gespeichert");
  };
  // Finding 2: Löschen lief bisher ohne jede Rückfrage sofort und
  // unwiderruflich (EntryDetail-Klick -> direkt handleDelete), UND ohne
  // try/catch -- ein DB-Fehler wäre eine unhandled rejection gewesen (Modal
  // bleibt kommentarlos offen, keine Meldung). requestDelete fragt jetzt über
  // denselben Bestätigungsdialog nach, der schon für "ungespeicherte
  // Änderungen verwerfen" existiert (App.tsx confirmDiscard); handleDelete
  // selbst ist zusätzlich try/catch-abgesichert. Ein Soft-Delete/Undo wird
  // bewusst NICHT gebaut: deleteEntry läuft atomar (db_batch), und das
  // automatische Backup bei jedem Entsperren (Finding 5/W3, backupNow) ist
  // die zweite Verteidigungslinie gegen einen Fehlklick trotz Bestätigung.
  const requestDelete = (id: string) => {
    setConfirmDiscard({
      message: "Diesen Eintrag unwiderruflich löschen?",
      confirmLabel: "Löschen",
      onConfirm: () => {
        setConfirmDiscard(null);
        void handleDelete(id);
      },
    });
  };
  const handleDelete = async (id: string) => {
    try {
      await deleteEntry(id);
      setModal(null);
      bump();
      showToast("Eintrag gelöscht");
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  const editFromDetail = async (entry: EntryFullItem) => {
    try {
      const fresh = (await getEntry(entry.id)) ?? entry;
      setFormDirty(false);
      setModal({ type: "form", entry: fresh });
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };

  // Übernimmt einen bestehenden Eintrag als Vorlage: heutiges Datum, frische
  // ID, ohne die (fallbezogenen) Widersprüche der Geschäftsleitung. Die Quelle
  // ist ein VOLL geladenes Item (EntryFullItem) – secretDetails wird korrekt
  // mitkopiert, statt (bei einem schlanken Listen-Item) leer zu bleiben.
  const duplicateEntry = (source: EntryFullItem): TimeEntry => {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      date: todayIso(),
      startTime: source.startTime,
      endTime: source.endTime,
      durationMinutes: source.durationMinutes,
      infoForManagement: source.infoForManagement,
      secretDetails: source.secretDetails,
      hadPlannedShift: source.hadPlannedShift,
      shiftCompensationNote: source.shiftCompensationNote,
      isCompensation: source.isCompensation ?? false,
      tagIds: source.tagIds,
      objections: [],
      createdAt: now,
      updatedAt: now,
    };
  };
  const handleDuplicate = (entry: EntryFullItem) => {
    setFormDirty(false);
    setModal({ type: "form", entry: duplicateEntry(entry) });
  };

  // Schließen des Bearbeiten-Formulars (Backdrop-Klick, Abbrechen, Escape) –
  // bei ungespeicherten Änderungen erst rückfragen, statt kommentarlos zu verwerfen.
  const requestCloseModal = () => {
    if (modal?.type === "form" && formDirty) {
      setConfirmDiscard({
        message: "Ungespeicherte Änderungen am Eintrag verwerfen?",
        onConfirm: () => {
          setFormDirty(false);
          setConfirmDiscard(null);
          setModal(null);
        },
      });
      return;
    }
    setModal(null);
  };

  // Sidebar-Navigation: beim Verlassen von "Zeit erfassen" mit unges. Eingaben
  // rückfragen (sonst geht der Draft durch das Unmounten der View verloren).
  const requestNavigate = (v: View) => {
    if (view === "erfassen" && v !== "erfassen" && quickEntryDirty) {
      setConfirmDiscard({
        message: "Ungespeicherte Eingaben im Erfassen-Formular verwerfen?",
        onConfirm: () => {
          clearQuickEntryDraft();
          setQuickEntryDirty(false);
          setConfirmDiscard(null);
          setView(v);
        },
      });
      return;
    }
    setView(v);
  };

  if (startMode === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
        Wird geladen…
      </div>
    );
  }

  if (locked) {
    return (
      <LockScreen
        startMode={startMode}
        startMessage={startMessage}
        onUnlocked={handleUnlocked}
      />
    );
  }

  if (initError) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
        <div className="max-w-md space-y-4 p-4 text-center">
          <div>
            <p className="font-medium text-red-600 dark:text-red-400">
              Fehler beim Start
            </p>
            <p className="mt-1 break-all text-sm">{initError}</p>
          </div>

          <button
            type="button"
            onClick={retryInit}
            disabled={retrying}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {retrying ? "Wird erneut versucht…" : "Erneut versuchen"}
          </button>

          {initDbPath && (
            <div className="rounded bg-slate-100 p-2 text-left text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <div className="font-medium">Datenbank-Datei:</div>
              <div className="mt-1 break-all">{initDbPath}</div>
            </div>
          )}

          <p className="text-left text-xs text-slate-500 dark:text-slate-400">
            Bleibt der Fehler bestehen: Die Datenbank am oben genannten Pfad
            zuvor kopieren (sichern). Ein früher erstelltes JSON-Backup lässt
            sich anschließend über „Daten → Sicherung &amp; Übertragung →
            Import" wieder einspielen.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
        Daten werden geladen…
      </div>
    );
  }

  // Finding 31: Schwelle für den Erinnerungs-Banner. Ohne Einträge (Neu-
  // installation) oder solange der Nutzer ihn für diese Sitzung ausgeblendet
  // hat, bleibt der Hinweis stumm.
  const daysSinceLastEntry = lastEntryDate
    ? differenceInCalendarDays(new Date(), parseISO(lastEntryDate))
    : null;
  const showReminder =
    !reminderDismissed && daysSinceLastEntry !== null && daysSinceLastEntry >= 3;

  return (
    <div className="flex h-full flex-col">
      {showReminder && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <span>
            Letzter Eintrag vor {daysSinceLastEntry} Tagen ({formatDateDe(lastEntryDate!)}
            ). Zeitnahe Erfassung stärkt den Nachweis.
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => setReminderDismissed(true)}
          >
            Ausblenden
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar view={view} onNavigate={requestNavigate} onLockNow={doLock} />

        <main className="flex-1 overflow-y-auto">
          {view === "erfassen" && (
            <QuickEntryView
              tags={allTags}
              onDirtyChange={setQuickEntryDirty}
              onOpenEntry={openDetail}
              onSaved={() => {
                bump();
                showToast("Eintrag gespeichert");
              }}
            />
          )}
          {view === "historie" && (
            <HistoryView
              tags={tags}
              reloadKey={reloadKey}
              onOpenEntry={openDetail}
              onNewEntry={openNew}
            />
          )}
          {view === "auswertung" && <StatsView reloadKey={reloadKey} />}
          {view === "daten" && (
            <DataView
              reloadKey={reloadKey}
              onChanged={() => {
                loadTags();
                loadAllTags();
                bump();
              }}
              onLockNow={doLock}
              onAutoLockChanged={setAutoLockMin}
            />
          )}
        </main>
      </div>

      {/* Modal: Detailansicht / Bearbeiten / Schnell-Anlegen aus Kalender/Liste */}
      {modal && (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          onClick={requestCloseModal}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-modal-heading"
            tabIndex={-1}
            className="my-4 w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl outline-none dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "form" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100"
                >
                  Eintrag
                </h2>
                <EntryForm
                  entry={modal.entry}
                  tags={allTags}
                  dateInputRef={dateFieldRef}
                  onSaved={handleModalSaved}
                  onCancel={requestCloseModal}
                  onDraftChange={(_draft, dirty) => setFormDirty(dirty)}
                />
              </>
            )}
            {modal.type === "detail" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100"
                >
                  Eintrag-Details
                </h2>
                <EntryDetail
                  entry={modal.entry}
                  onEdit={() => editFromDetail(modal.entry)}
                  onDelete={() => requestDelete(modal.entry.id)}
                  onDuplicate={() => handleDuplicate(modal.entry)}
                  onClose={() => setModal(null)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Bestätigung: ungespeicherte Eingaben verwerfen ODER Eintrag löschen
          (Finding 2) -- derselbe Dialog, confirmLabel unterscheidet den
          destruktiven Button ("Verwerfen" vs. "Löschen"). */}
      {confirmDiscard && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDiscard(null)}
        >
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-label={confirmDiscard.message}
            tabIndex={-1}
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl outline-none dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {confirmDiscard.message}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className={secondaryBtnCls}
                onClick={() => setConfirmDiscard(null)}
              >
                Zurück
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                onClick={confirmDiscard.onConfirm}
              >
                {confirmDiscard.confirmLabel ?? "Verwerfen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast -- aria-live meldet die Bestätigung auch Screenreader-Nutzern
          (Finding 41), ohne dass der Fokus verschoben wird. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-700"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
