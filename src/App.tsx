import { useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type {
  TimeEntry,
  TaskTag,
  EntryListItem,
  EntryFullItem,
  Appointment,
  AppointmentFullItem,
} from "./types";
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
  newAppointment,
  newReminder,
  getAppointment,
  deleteAppointment,
  deleteOccurrence,
  splitSeries,
  truncateSeries,
} from "./db/repository";
import { applyTheme, getStoredTheme, watchSystemTheme } from "./lib/theme";
import { toUserMessage } from "./lib/errors";
import { formatDateDe, todayIso } from "./lib/calendar";
import { secondaryBtnCls } from "./lib/ui";
import { isAndroid } from "./lib/platform";
import { useBackClose } from "./lib/backClose";
import {
  type StartMode,
  getStartStatus,
  getAutoLockMinutes,
  startIdleTimer,
  lock,
} from "./lib/auth";
import Sidebar, { type View } from "./components/Sidebar";
import BottomNav from "./components/BottomNav";
import TopBar from "./components/TopBar";
import QuickEntryView, { clearQuickEntryDraft } from "./views/QuickEntryView";
import HistoryView from "./views/HistoryView";
import CalendarPage from "./views/CalendarPage";
import StatsView from "./views/StatsView";
import DataView from "./views/DataView";
import LockScreen from "./views/LockScreen";
import EntryForm from "./components/EntryForm";
import EntryDetail from "./components/EntryDetail";
import AppointmentForm from "./components/AppointmentForm";
import AppointmentDetail, {
  type OccurrenceRef,
} from "./components/AppointmentDetail";
import SeriesScopeDialog, {
  type SeriesScope,
} from "./components/SeriesScopeDialog";
import SettingsPanel from "./components/SettingsPanel";
import AboutPanel from "./components/AboutPanel";
import { Icon } from "./components/Icon";
import {
  remainingCountFrom,
  rruleWithUntil,
  splitUntilDate,
  type Occurrence,
} from "./lib/appointments";

type Modal =
  | { type: "form"; entry: TimeEntry }
  | { type: "detail"; entry: EntryFullItem }
  // Terminkalender: Formular + Detailansicht laufen über denselben Modal-
  // Mechanismus wie die Eintrags-Dialoge. `occ` ist die konkret angezeigte
  // Instanz (bei Serien ≠ Master-Startdaten); `saveAction`/`contextHint`
  // steuern die Serien-Sonderfälle des Formulars (Override, UNTIL-Split).
  | {
      type: "apptForm";
      appointment: Appointment;
      saveAction?: (appt: Appointment) => Promise<void>;
      contextHint?: string;
    }
  | { type: "apptDetail"; appointment: AppointmentFullItem; occ: OccurrenceRef }
  // Einstellungen/Über BR-Log (aus dem neuen AppMenu, siehe Sidebar/TopBar):
  // laufen bewusst über denselben Modal-Mechanismus wie Bearbeiten/Detail
  // (gleiche Fokusfalle, gleiches mobil-/Desktop-Layout) statt einer
  // Parallelstruktur.
  | { type: "settings" }
  | { type: "about" }
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
  // Einzige Stelle, an der isAndroid() für das Layout abgefragt wird
  // (Konvention, siehe platform.ts/CLAUDE): lazy useState statt eines
  // Aufrufs bei jedem Render, Ergebnis ändert sich zur Laufzeit ohnehin nie.
  // Steuert NUR das App-Gerüst (Sidebar vs. TopBar+BottomNav) -- bewusst
  // NICHT über Tailwind-Breakpoints, damit ein schmales Desktop-Fenster
  // weiter die Sidebar zeigt.
  const [mobile] = useState(() => isAndroid());
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
  // Drei-Optionen-Dialog "Nur dieser / Dieser und folgende / Alle" für das
  // Bearbeiten/Löschen von Serieninstanzen (liegt wie confirmDiscard ÜBER dem
  // Detail-Modal).
  const [seriesScope, setSeriesScope] = useState<{
    mode: "edit" | "delete";
    appt: AppointmentFullItem;
    occ: OccurrenceRef;
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
    // Eintragsformular: Datumsfeld; Terminformular: Titelfeld (gleiche Ref,
    // es ist immer nur EIN Modal offen).
    modal?.type === "form" || modal?.type === "apptForm"
      ? dateFieldRef
      : undefined
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
  // Einstellungen/Über BR-Log aus dem neuen AppMenu (Sidebar-Fuß/Android-
  // TopBar) -- beide ohne Dirty-Zustand, requestCloseModal (unten) verwirft
  // sie deshalb immer direkt, ohne Rückfrage.
  const openSettings = () => setModal({ type: "settings" });
  const openAbout = () => setModal({ type: "about" });
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

  // ---------- Termin-Dialoge (Muster der Eintrags-Dialoge) ----------

  const openNewAppointment = (iso: string) => {
    setFormDirty(false);
    setModal({ type: "apptForm", appointment: newAppointment(iso) });
  };
  // Detailansicht lädt den Termin VOLLSTÄNDIG nach (inkl. secretDetails) --
  // Kalender-/Agenda-Items tragen das vertrauliche Feld strukturell nicht.
  // Bei Overrides werden Schlagwörter/Erinnerungen des Masters eingeblendet
  // (Overrides erben sie, ihre eigene Zeile trägt keine).
  const openOccurrence = async (occ: Occurrence) => {
    try {
      let full = await getAppointment(occ.appointment.id);
      if (!full) {
        showToast("Termin nicht gefunden");
        bump();
        return;
      }
      if (full.parentId) {
        const master = await getAppointment(full.parentId);
        if (master) {
          full = {
            ...full,
            tagIds: master.tagIds,
            tagLabels: master.tagLabels,
            reminders: master.reminders,
          };
        }
      }
      setModal({
        type: "apptDetail",
        appointment: full,
        occ: {
          anchor: occ.anchor,
          startDate: occ.startDate,
          startTime: occ.startTime,
          endDate: occ.endDate,
          endTime: occ.endTime,
        },
      });
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  const handleApptSaved = () => {
    setModal(null);
    setFormDirty(false);
    bump();
    showToast("Termin gespeichert");
  };
  const editApptFromDetail = async (appt: AppointmentFullItem) => {
    try {
      const fresh = (await getAppointment(appt.id)) ?? appt;
      setFormDirty(false);
      setModal({ type: "apptForm", appointment: fresh });
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  const requestApptDelete = (id: string, message?: string) => {
    setConfirmDiscard({
      message: message ?? "Diesen Termin unwiderruflich löschen?",
      confirmLabel: "Löschen",
      onConfirm: () => {
        setConfirmDiscard(null);
        void handleApptDelete(id);
      },
    });
  };

  // ---------- Serien-Bearbeitung/-Löschung (Scope-Dialog) ----------

  /** AppointmentFullItem -> Appointment (ohne Anzeige-Felder tagLabels/search). */
  const plainAppointment = (a: AppointmentFullItem): Appointment => ({
    id: a.id,
    title: a.title,
    location: a.location,
    description: a.description,
    secretDetails: a.secretDetails,
    isAllDay: a.isAllDay,
    startDate: a.startDate,
    startTime: a.startTime,
    endDate: a.endDate,
    endTime: a.endTime,
    isImportant: a.isImportant,
    color: a.color,
    rrule: a.rrule,
    exdates: a.exdates,
    parentId: a.parentId,
    recurrenceAnchor: a.recurrenceAnchor,
    icsUid: a.icsUid,
    icsSequence: a.icsSequence,
    tagIds: a.tagIds,
    reminders: a.reminders,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  });

  /** Entwurf einer Serien-Ausnahme ("nur dieser") aus der Master-Instanz. */
  const buildOverrideDraft = (
    master: AppointmentFullItem,
    occ: OccurrenceRef
  ): Appointment => {
    const now = new Date().toISOString();
    return {
      ...plainAppointment(master),
      id: crypto.randomUUID(),
      startDate: occ.startDate,
      startTime: occ.startTime,
      endDate: occ.endDate,
      endTime: occ.endTime,
      rrule: null,
      exdates: [],
      parentId: master.id,
      recurrenceAnchor: occ.anchor,
      icsUid: null,
      icsSequence: 0,
      // Overrides erben Schlagwörter/Erinnerungen -- eigene Zeile trägt keine.
      tagIds: [],
      reminders: [],
      createdAt: now,
      updatedAt: now,
    };
  };

  /** Entwurf der NEUEN Serie ab dem Anker ("dieser und folgende"). */
  const buildSplitDraft = (
    master: AppointmentFullItem,
    occ: OccurrenceRef
  ): Appointment => {
    const now = new Date().toISOString();
    const spanDays = differenceInCalendarDays(
      parseISO(master.endDate),
      parseISO(master.startDate)
    );
    // Bei COUNT-Regeln bekommt der neue Teil das RESTLICHE Kontingent --
    // sonst würde die Gesamtzahl der Termine durch den Split wachsen.
    let rrule = master.rrule;
    if (rrule) {
      const remaining = remainingCountFrom(master, occ.anchor);
      if (remaining !== null) rrule = rrule.replace(/COUNT=\d+/i, `COUNT=${remaining}`);
    }
    return {
      ...plainAppointment(master),
      id: crypto.randomUUID(),
      startDate: occ.anchor,
      endDate: format(addDays(parseISO(occ.anchor), spanDays), "yyyy-MM-dd"),
      rrule,
      exdates: master.exdates.filter((d) => d >= occ.anchor),
      icsUid: null,
      icsSequence: 0,
      reminders: master.reminders.map((r) => newReminder(r.minutesBefore)),
      createdAt: now,
      updatedAt: now,
    };
  };

  /** Master mit UNTIL = Vortag des Ankers (alter Serienteil bei Split/Kürzen). */
  const truncatedMaster = (
    master: AppointmentFullItem,
    anchor: string
  ): Appointment => ({
    ...plainAppointment(master),
    rrule: master.rrule
      ? rruleWithUntil(master.rrule, splitUntilDate(anchor))
      : master.rrule,
    exdates: master.exdates.filter((d) => d < anchor),
  });

  // Bearbeiten/Löschen aus der Detailansicht: Einzeltermine direkt, Serien-
  // Instanzen (Master ODER Override) über den Scope-Dialog.
  const requestApptEdit = (appt: AppointmentFullItem, occ: OccurrenceRef) => {
    if (appt.rrule === null && appt.parentId === null) {
      void editApptFromDetail(appt);
      return;
    }
    setSeriesScope({ mode: "edit", appt, occ });
  };
  const requestApptDeleteSmart = (appt: AppointmentFullItem, occ: OccurrenceRef) => {
    if (appt.rrule === null && appt.parentId === null) {
      requestApptDelete(appt.id);
      return;
    }
    setSeriesScope({ mode: "delete", appt, occ });
  };

  const handleSeriesScopeSelect = async (scope: SeriesScope) => {
    const ctx = seriesScope;
    if (!ctx) return;
    setSeriesScope(null);
    const { mode, appt, occ } = ctx;
    const masterId = appt.parentId ?? appt.id;
    const anchor = appt.parentId ? appt.recurrenceAnchor ?? occ.anchor : occ.anchor;
    try {
      const master = await getAppointment(masterId);
      if (!master) {
        showToast("Termin nicht gefunden");
        bump();
        return;
      }
      if (mode === "edit") {
        setFormDirty(false);
        if (scope === "all") {
          setModal({
            type: "apptForm",
            appointment: plainAppointment(master),
            contextHint:
              "Änderungen gelten für ALLE Termine der Serie. Einzeln geänderte " +
              "Instanzen behalten ihre Abweichungen, solange sich das Datumsraster " +
              "der Serie nicht ändert.",
          });
        } else if (scope === "single") {
          const isOverride = appt.parentId !== null;
          setModal({
            type: "apptForm",
            appointment: isOverride
              ? { ...plainAppointment(appt), tagIds: [], reminders: [] }
              : buildOverrideDraft(master, occ),
            contextHint: `Nur der Termin am ${formatDateDe(anchor)} wird geändert. Erinnerungen und Schlagwörter erbt er weiterhin von der Serie.`,
          });
        } else {
          const oldMaster = truncatedMaster(master, anchor);
          setModal({
            type: "apptForm",
            appointment: buildSplitDraft(master, occ),
            contextHint: `Änderungen gelten ab dem ${formatDateDe(anchor)}. Frühere Termine der Serie bleiben unverändert.`,
            saveAction: (a) =>
              splitSeries({ master: oldMaster, newSeries: a, anchor }),
          });
        }
      } else {
        if (scope === "all") {
          requestApptDelete(
            masterId,
            "Die GESAMTE Serie unwiderruflich löschen (alle Termine)?"
          );
        } else if (scope === "single") {
          await deleteOccurrence(masterId, anchor);
          setModal(null);
          bump();
          showToast("Termin gelöscht");
        } else {
          await truncateSeries({ master: truncatedMaster(master, anchor), anchor });
          setModal(null);
          bump();
          showToast("Termin und Folgetermine gelöscht");
        }
      }
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  const handleApptDelete = async (id: string) => {
    try {
      await deleteAppointment(id);
      setModal(null);
      bump();
      showToast("Termin gelöscht");
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  // Übernimmt einen Termin als Vorlage: frische ID, heutiges Datum unter
  // Erhalt der Dauer in Tagen, NEUE Erinnerungs-IDs (appointment_reminders.id
  // ist global eindeutig -- kopierte IDs würden am PK scheitern) und ohne
  // ICS-Identität (UID/SEQUENCE gehören zum Original).
  const duplicateAppointment = (source: AppointmentFullItem): Appointment => {
    const now = new Date().toISOString();
    const today = todayIso();
    const spanDays = differenceInCalendarDays(
      parseISO(source.endDate),
      parseISO(source.startDate)
    );
    return {
      id: crypto.randomUUID(),
      title: source.title,
      location: source.location,
      description: source.description,
      secretDetails: source.secretDetails,
      isAllDay: source.isAllDay,
      startDate: today,
      startTime: source.startTime,
      endDate: format(addDays(parseISO(today), spanDays), "yyyy-MM-dd"),
      endTime: source.endTime,
      isImportant: source.isImportant,
      color: source.color,
      rrule: null,
      exdates: [],
      parentId: null,
      recurrenceAnchor: null,
      icsUid: null,
      icsSequence: 0,
      tagIds: source.tagIds,
      reminders: source.reminders.map((r) => newReminder(r.minutesBefore)),
      createdAt: now,
      updatedAt: now,
    };
  };
  const handleApptDuplicate = (appt: AppointmentFullItem) => {
    setFormDirty(false);
    setModal({ type: "apptForm", appointment: duplicateAppointment(appt) });
  };
  // "Zeit buchen": Eintragsformular vorbefüllt aus dem Termin -- Datum und
  // Uhrzeiten der konkreten INSTANZ (bei ganztägig leer), Titel als GL-Info,
  // Schlagwörter.
  const bookTimeFromAppointment = (appt: AppointmentFullItem, occ: OccurrenceRef) => {
    const entry = newEntry(occ.startDate);
    entry.startTime = appt.isAllDay ? null : occ.startTime;
    entry.endTime = appt.isAllDay ? null : occ.endTime;
    entry.infoForManagement = appt.title;
    entry.tagIds = appt.tagIds;
    setFormDirty(false);
    setModal({ type: "form", entry });
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
      pauseMinutes: source.pauseMinutes,
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
    if ((modal?.type === "form" || modal?.type === "apptForm") && formDirty) {
      setConfirmDiscard({
        message:
          modal.type === "form"
            ? "Ungespeicherte Änderungen am Eintrag verwerfen?"
            : "Ungespeicherte Änderungen am Termin verwerfen?",
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

  // Android-Zurück-Taste (mobile-gated): schließt offene Overlays statt die
  // App zu beenden (Mechanik siehe lib/backClose.ts). Zwei getrennte
  // Registrierungen -- der Bestätigungsdialog liegt ÜBER dem Modal und
  // registriert sich später, ist also oben auf dem Handler-Stapel: Zurück
  // schließt erst die Rückfrage (= Abbrechen), dann das Modal. Der Modal-Weg
  // läuft bewusst durch requestCloseModal: beim Formular greift der
  // Dirty-Check und öffnet ggf. die Rückfrage, statt still zu verwerfen.
  // Das AppMenu-Popover registriert sich selbst (AppMenu.tsx) -- als
  // zuletzt geöffnetes Element automatisch zuoberst ("Menü vor Modal").
  // Bei `locked` deregistriert alles: Zurück auf dem LockScreen verlässt
  // die App wie gewohnt (visibilitychange-Lock bleibt unberührt).
  useBackClose(mobile && !locked && modal !== null, requestCloseModal);
  useBackClose(mobile && !locked && confirmDiscard !== null, () =>
    setConfirmDiscard(null)
  );
  useBackClose(mobile && !locked && seriesScope !== null, () =>
    setSeriesScope(null)
  );

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
        mobile={mobile}
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

      {mobile && (
        <TopBar
          view={view}
          onOpenSettings={openSettings}
          onOpenAbout={openAbout}
          onLockNow={doLock}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {!mobile && (
          <Sidebar
            view={view}
            onNavigate={requestNavigate}
            onOpenSettings={openSettings}
            onOpenAbout={openAbout}
            onLockNow={doLock}
          />
        )}

        <main
          className={
            mobile
              ? "flex-1 overflow-y-auto pb-[4.5rem]"
              : "flex-1 overflow-y-auto"
          }
        >
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
          {view === "kalender" && (
            <CalendarPage
              reloadKey={reloadKey}
              onOpenEntry={openDetail}
              onNewEntry={openNew}
              onOpenOccurrence={openOccurrence}
              onNewAppointment={openNewAppointment}
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
            />
          )}
        </main>
      </div>

      {mobile && <BottomNav view={view} onNavigate={requestNavigate} />}

      {/* Modal: Detailansicht / Bearbeiten / Schnell-Anlegen aus Kalender/Liste.
          Auf Android nahezu fullscreen (kein abgerundeter Rahmen, kein
          Außenabstand, volle Höhe mit eigenem Scroll) -- ein zentriertes
          max-w-2xl-Modal mit p-4-Rand verschenkt auf einem 360-430px breiten
          Portrait-Bildschirm zu viel Platz für ein Formular mit drei Blöcken. */}
      {modal && (
        <div
          className={
            mobile
              ? "fixed inset-0 z-20 flex items-stretch justify-center overflow-y-auto bg-black/50"
              : "fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
          }
          onClick={requestCloseModal}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-modal-heading"
            tabIndex={-1}
            className={
              mobile
                ? "min-h-full w-full rounded-none bg-white p-4 shadow-xl outline-none dark:bg-slate-800"
                : // "Über BR-Log" ist bewusst ein kleines Modal (siehe Auftrag),
                  // alle anderen (Formular/Detail/Einstellungen) bleiben beim
                  // gewohnten max-w-2xl -- selber Container/Mechanismus, nur die
                  // Breite variiert mit dem Modal-Typ.
                  "my-4 w-full rounded-lg bg-white p-4 shadow-xl outline-none dark:bg-slate-800 " +
                  (modal.type === "about" ? "max-w-sm" : "max-w-2xl")
            }
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
            {modal.type === "apptForm" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100"
                >
                  Termin
                </h2>
                <AppointmentForm
                  appointment={modal.appointment}
                  tags={allTags}
                  titleInputRef={dateFieldRef}
                  onSaved={handleApptSaved}
                  onCancel={requestCloseModal}
                  onDraftChange={(_draft, dirty) => setFormDirty(dirty)}
                  saveAction={modal.saveAction}
                  contextHint={modal.contextHint}
                />
              </>
            )}
            {modal.type === "apptDetail" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100"
                >
                  Termin-Details
                </h2>
                <AppointmentDetail
                  appointment={modal.appointment}
                  occurrence={modal.occ}
                  onEdit={() => requestApptEdit(modal.appointment, modal.occ)}
                  onDelete={() => requestApptDeleteSmart(modal.appointment, modal.occ)}
                  onDuplicate={() => handleApptDuplicate(modal.appointment)}
                  onBookTime={() =>
                    bookTimeFromAppointment(modal.appointment, modal.occ)
                  }
                  onClose={() => setModal(null)}
                />
              </>
            )}
            {/* Schließen-Muster der beiden AppMenu-Modals: X-Button im
                Modal-Kopf (statt Footer-Button wie im Detail-Modal). Grund:
                Einstellungen ist lang und scrollt -- ein Footer-Button wäre
                beim Öffnen unsichtbar (unterhalb des Folds), das X oben ist
                sofort als Ausweg erkennbar. Auf Android (fullscreen-nah, kein
                sichtbarer Backdrop) ist es der einzige sichtbare Ausweg neben
                der System-Zurück-Taste. Form/Detail behalten ihre Footer-
                Aktionsleisten (dort ist Schließen Teil echter Aktionen). Das
                X ist zudem das erste fokussierbare Element -> die Fokusfalle
                (useModalFocusTrap) fokussiert es beim Öffnen. */}
            {modal.type === "settings" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2
                    id="entry-modal-heading"
                    className="text-base font-semibold text-slate-800 dark:text-slate-100"
                  >
                    Einstellungen
                  </h2>
                  <button
                    type="button"
                    aria-label="Schließen"
                    title="Schließen"
                    onClick={requestCloseModal}
                    className="-my-2 -mr-2 flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <Icon name="x" size={20} />
                  </button>
                </div>
                <SettingsPanel
                  onLockNow={doLock}
                  onAutoLockChanged={setAutoLockMin}
                  mobile={mobile}
                />
              </>
            )}
            {modal.type === "about" && (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 id="entry-modal-heading" className="sr-only">
                    Über BR-Log
                  </h2>
                  <button
                    type="button"
                    aria-label="Schließen"
                    title="Schließen"
                    onClick={requestCloseModal}
                    className="-my-2 -mr-2 ml-auto flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <Icon name="x" size={20} />
                  </button>
                </div>
                <AboutPanel />
              </>
            )}
          </div>
        </div>
      )}

      {/* Serien-Scope: "Nur dieser / Dieser und folgende / Alle" -- liegt wie
          der Bestätigungsdialog über dem Detail-Modal. */}
      {seriesScope && (
        <SeriesScopeDialog
          mode={seriesScope.mode}
          onSelect={(scope) => void handleSeriesScopeSelect(scope)}
          onCancel={() => setSeriesScope(null)}
        />
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
          (Finding 41), ohne dass der Fokus verschoben wird. Auf Android weiter
          oben verankert, sonst läge er hinter/unter der BottomNav. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={
            mobile
              ? "fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-700"
              : "fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-700"
          }
        >
          {toast}
        </div>
      )}
    </div>
  );
}
