import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { TimeEntry, TaskTag, EntryListItem, EntryFullItem } from "./types";
import {
  initSchema,
  initSearch,
  resetDbCaches,
  getDbPathInfo,
  backupNow,
} from "./db/client";
import { listTags, newEntry, deleteEntry, getEntry } from "./db/repository";
import { applyTheme, getStoredTheme, watchSystemTheme } from "./lib/theme";
import { toUserMessage } from "./lib/errors";
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
import DataView from "./views/DataView";
import LockScreen from "./views/LockScreen";
import EntryForm from "./components/EntryForm";
import EntryDetail from "./components/EntryDetail";

type Modal =
  | { type: "form"; entry: TimeEntry }
  | { type: "detail"; entry: EntryFullItem }
  | null;

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
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
  const [confirmDiscard, setConfirmDiscard] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const bump = () => setReloadKey((k) => k + 1);
  const loadTags = () => listTags().then(setTags);
  const loadAllTags = () => listTags(true).then(setAllTags);
  const showToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  };

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

  // Sperren: Rust verwirft Schlüssel + Connection; UI zurück zum LockScreen.
  const doLock = () => {
    void lock().finally(() => {
      setReady(false);
      setLocked(true);
    });
  };

  // Auto-Lock bei Inaktivität (Pflicht) + Sperren beim Minimieren.
  useEffect(() => {
    if (!ready || locked) return;
    const stopIdle = startIdleTimer(autoLockMin, doLock);
    let cancelled = false;
    let unlistenMin: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const u = await win.onResized(async () => {
          if (await win.isMinimized()) doLock();
        });
        if (cancelled) u();
        else unlistenMin = u;
      } catch {
        // außerhalb von Tauri (z. B. reiner Vite-Dev) -> ignorieren
      }
    })();
    return () => {
      cancelled = true;
      stopIdle();
      unlistenMin?.();
    };
  }, [ready, locked, autoLockMin]);

  const openNew = (iso?: string) => {
    setFormDirty(false);
    setModal({ type: "form", entry: newEntry(iso ?? todayIso()) });
  };
  // Detailansicht öffnet den Eintrag VOLLSTÄNDIG (Refetch inkl. secretDetails);
  // Listen-Items tragen das vertrauliche Feld bewusst nicht mehr.
  const openDetail = async (entry: EntryListItem) => {
    const full = await getEntry(entry.id);
    if (!full) {
      showToast("Eintrag nicht gefunden");
      bump();
      return;
    }
    setModal({ type: "detail", entry: full });
  };

  const handleModalSaved = () => {
    setModal(null);
    setFormDirty(false);
    bump();
    showToast("Eintrag gespeichert");
  };
  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setModal(null);
    bump();
    showToast("Eintrag gelöscht");
  };
  const editFromDetail = async (entry: EntryFullItem) => {
    const fresh = (await getEntry(entry.id)) ?? entry;
    setFormDirty(false);
    setModal({ type: "form", entry: fresh });
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

  return (
    <div className="flex h-full">
      <Sidebar view={view} onNavigate={requestNavigate} onLockNow={doLock} />

      <main className="flex-1 overflow-y-auto">
        {view === "erfassen" && (
          <QuickEntryView
            tags={allTags}
            onDirtyChange={setQuickEntryDirty}
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
        {view === "daten" && (
          <DataView
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

      {/* Modal: Detailansicht / Bearbeiten / Schnell-Anlegen aus Kalender/Liste */}
      {modal && (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          onClick={requestCloseModal}
        >
          <div
            className="my-4 w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "form" && (
              <>
                <h2 className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100">
                  Eintrag
                </h2>
                <EntryForm
                  entry={modal.entry}
                  tags={allTags}
                  onSaved={handleModalSaved}
                  onCancel={requestCloseModal}
                  onDraftChange={(_draft, dirty) => setFormDirty(dirty)}
                />
              </>
            )}
            {modal.type === "detail" && (
              <>
                <h2 className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100">
                  Eintrag-Details
                </h2>
                <EntryDetail
                  entry={modal.entry}
                  onEdit={() => editFromDetail(modal.entry)}
                  onDelete={() => handleDelete(modal.entry.id)}
                  onDuplicate={() => handleDuplicate(modal.entry)}
                  onClose={() => setModal(null)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Bestätigung: ungespeicherte Eingaben verwerfen (Modal-Schließen, View-Wechsel) */}
      {confirmDiscard && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDiscard(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {confirmDiscard.message}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                onClick={() => setConfirmDiscard(null)}
              >
                Zurück
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                onClick={confirmDiscard.onConfirm}
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-700">
          {toast}
        </div>
      )}
    </div>
  );
}
