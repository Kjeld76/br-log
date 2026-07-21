import { useEffect, useRef, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
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
  getAppointment,
  deleteAppointment,
  deleteOccurrence,
  splitSeries,
  truncateSeries,
} from "./db/repository";
import { reminderBody } from "./lib/reminderScheduler";
import { applyTheme, getStoredTheme, watchSystemTheme } from "./lib/theme";
import { toUserMessage } from "./lib/errors";
import { formatDateDe, todayIso } from "./lib/calendar";
import { secondaryBtnCls } from "./lib/ui";
import { isAndroid } from "./lib/platform";
import { applyLockHotkey, setLockHotkeyTrigger } from "./lib/lockHotkey";
import { createLockDelay, getAndroidLockDelaySec } from "./lib/lockDelay";
import { applySecureScreenSetting } from "./lib/secureScreen";
import { getBlurOnFocusLossEnabled } from "./lib/blurOnFocusLoss";
import { clearModalDraft, saveModalDraft, takeModalDraft } from "./lib/modalDraftStore";
import { listen } from "@tauri-apps/api/event";
import { useBackClose } from "./lib/backClose";
import { useModalFocusTrap } from "./lib/useModalFocusTrap";
import { useReminderScheduler } from "./lib/useReminderScheduler";
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
import AppointmentDetail from "./components/AppointmentDetail";
import SeriesScopeDialog, {
  type SeriesScope,
} from "./components/SeriesScopeDialog";
import SettingsPanel from "./components/SettingsPanel";
import AboutPanel from "./components/AboutPanel";
import { Icon } from "./components/Icon";
import {
  buildOverrideDraft,
  buildSplitDraft,
  duplicateAppointment,
  plainAppointment,
  resolveOverride,
  truncatedMaster,
  type Occurrence,
  type OccurrenceRef,
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
  // Android-Karenz vorm Sperren beim Verstecken (Issue #17, Task 7, Sentinel
  // 0 = "Sofort"/Bestandsverhalten). Lazy-Init liest die localStorage-
  // Einstellung synchron (kein Geheimnis, s. lockDelay.ts); SecurityPanel
  // meldet Änderungen über onAndroidLockDelayChanged zurück (analog
  // onAutoLockChanged/autoLockMin).
  const [androidLockDelaySec, setAndroidLockDelaySec] = useState(() =>
    getAndroidLockDelaySec()
  );
  // Sichtschutz-Blur bei Fensterfokus-Verlust (Issue #17, Task 8,
  // Desktop-only, Default AN): lazy-Init liest die localStorage-Einstellung
  // synchron (kein Geheimnis, s. blurOnFocusLoss.ts); SecurityPanel meldet
  // Änderungen über onBlurOnFocusLossChanged zurück (analog
  // onAndroidLockDelayChanged/androidLockDelaySec).
  const [blurOnFocusLossEnabled, setBlurOnFocusLossEnabledState] = useState(() =>
    getBlurOnFocusLossEnabled()
  );
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
  // Eigener Zähler NUR für Termin-Mutationen (plus Backup-/ICS-Import): der
  // Erinnerungs-Snapshot inkl. Android-Neuplanung hängt daran -- am globalen
  // reloadKey würde jedes Speichern eines ZEITEINTRAGS (der häufigste Vorgang
  // der App) den kompletten Termin-Reload samt RRULE-Expansion auslösen.
  const [apptReloadKey, setApptReloadKey] = useState(0);
  const bumpAppointments = () => {
    setApptReloadKey((k) => k + 1);
    bump();
  };
  // Termin-Erinnerungen (Snapshot-Scheduler, Android-Planung, Nachhol-Banner):
  // s. reminderOrchestrator.ts/useReminderScheduler.ts (GitHub-Issue #6).
  const { missedReminders, dismissMissedReminders } = useReminderScheduler({
    ready,
    mobile,
    apptReloadKey,
  });
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
  // Aktuellster Formular-Entwurf des offenen Bearbeiten-Modals (Issue #17,
  // Task 9): wird von EntryForm/AppointmentForm über onDraftChange bei JEDER
  // Änderung mitgeschrieben (Draft-Kanal existiert bereits für formDirty).
  // doLock() greift diese Ref, um den Entwurf VOR dem Aufblitz-Schutz-
  // Unmount in modalDraftStore (reiner RAM, s. dort) zu sichern.
  const draftRef = useRef<TimeEntry | Appointment | null>(null);
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
      // Formular-Entwurf eines beim Sperren offenen Bearbeiten-Modals wieder
      // öffnen (Issue #17, Task 9) -- GENAU EINMAL: takeModalDraft entfernt
      // ihn aus dem RAM-Store, ein zweites Entsperren ohne zwischenzeitliches
      // erneutes Sperren stellt deshalb nichts mehr wieder her. modal.entry/
      // modal.appointment tragen hier bereits den EDITIERTEN Stand (s.
      // doLock) -- EntryForm/AppointmentForm nehmen das beim Neu-Mounten als
      // eigenen Ausgangszustand, der Dirty-Status ergibt sich dort wieder
      // organisch aus deren eigenem onDraftChange-Kanal.
      const restoredModal = takeModalDraft() as Modal | null;
      if (restoredModal) setModal(restoredModal);
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

  // Screenshot-/Vorschau-Schutz (Issue #17, Task 7, Android-only): die
  // Einstellung wird erst NACH dem Entsperren angewendet -- vorher gilt dank
  // MainActivity.onCreate sicherheitshalber immer FLAG_SECURE an (Auftrag).
  // secureScreen.ts ist auf Desktop ein No-op (isAndroid()-Guard dort).
  useEffect(() => {
    if (!mobile || !ready) return;
    void applySecureScreenSetting();
  }, [mobile, ready]);

  // Sichtschutz-Blur bei Fensterfokus-Verlust (Issue #17, Task 8,
  // Desktop-only): blurrt vertrauliche Anzeige-/Eingabeflächen (Klasse
  // `confidential-blur`, s. styles.css), solange das Fenster nicht im Fokus
  // ist -- reiner Sichtschutz gegen kurzes Wegklicken/über die Schulter
  // schauen, KEIN Ersatz für die Sperre (die läuft unverändert über den
  // separaten visibilitychange-Mechanismus oben). Auf Android registriert
  // dieser Effekt bewusst NICHTS (kein Fenster-Fokus-Konzept dort -- Wechsel
  // in eine andere App deckt bereits die visibilitychange-Sperre oben ab).
  // Bei ausgeschalteter Einstellung ebenfalls kein Listener (Guard analog
  // mobile). Das Cleanup entfernt das Attribut IMMER (Deaktivieren während
  // geblurrt / Unmount) -- sonst bliebe ein Fenster fälschlich dauerhaft
  // geblurrt.
  useEffect(() => {
    if (mobile || !blurOnFocusLossEnabled) return;
    const root = document.documentElement;
    const onBlur = () => root.setAttribute("data-window-blurred", "");
    const onFocus = () => root.removeAttribute("data-window-blurred");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      root.removeAttribute("data-window-blurred");
    };
  }, [mobile, blurOnFocusLossEnabled]);

  // Refs auf den JEWEILS aktuellen Modal-/Dirty-Zustand (Issue #17, Task 9):
  // dieselben drei NICHT-Button-Sperr-Auslöser unten (Idle-Timer, globaler
  // Hotkey, Tray-Event) registrieren ihre Listener einmalig bzw. mit
  // eingeschränkten Dependencies (s. lockedRef-Kommentar direkt darunter für
  // dasselbe Muster/denselben Grund) -- ohne diese Refs würde doLock() beim
  // tatsächlichen Auslösen den zum Registrierungszeitpunkt eingefangenen
  // (veralteten) modal/formDirty-Stand sehen, z. B. "kein offenes Formular",
  // selbst wenn beim echten Sperren längst eins mit ungespeichertem Entwurf
  // offen ist -- der Draft würde dann trotz offenem Formular NIE gesichert.
  const modalForLockRef = useRef(modal);
  useEffect(() => {
    modalForLockRef.current = modal;
  }, [modal]);
  const formDirtyRef = useRef(formDirty);
  useEffect(() => {
    formDirtyRef.current = formDirty;
  }, [formDirty]);

  // Sperren: Rust verwirft Schlüssel + Connection; UI zurück zum LockScreen.
  // Vorher (Issue #17, Task 9): ein offenes Bearbeiten-Modal (Eintrag/Termin)
  // MIT ungespeichertem Entwurf im modalDraftStore sichern -- der Aufblitz-
  // Schutz unmountet gleich darauf den gesamten Baum, EntryForm/
  // AppointmentForm verlieren dabei ihr eigenes, internes Draft-State (der
  // `modal`-State in App.tsx selbst bleibt zwar erhalten, trägt aber nur den
  // ORIGINAL-Eintrag/-Termin, nicht die Bearbeitung). Ohne offenes/dirty-es
  // Formular wird ein evtl. noch nicht abgeholter alter Draft verworfen
  // (clearModalDraft) statt stillschweigend liegen zu bleiben. Liest bewusst
  // über die Refs oben, NICHT die State-Variablen direkt (s. deren Kommentar).
  const doLock = () => {
    const currentModal = modalForLockRef.current;
    const currentlyDirty = formDirtyRef.current;
    if (
      (currentModal?.type === "form" || currentModal?.type === "apptForm") &&
      currentlyDirty &&
      draftRef.current
    ) {
      saveModalDraft(
        currentModal.type === "form"
          ? { ...currentModal, entry: draftRef.current as TimeEntry }
          : { ...currentModal, appointment: draftRef.current as Appointment }
      );
    } else {
      clearModalDraft();
    }
    void lock().finally(() => {
      setReady(false);
      setLocked(true);
    });
  };

  // Ref auf den aktuellen Sperrzustand: der globale Hotkey (System-Callback
  // von tauri-plugin-global-shortcut, außerhalb des React-Renderzyklus)
  // braucht beim Feuern den JEWEILS aktuellen Wert, nicht den zum Zeitpunkt
  // der einmaligen Registrierung eingefangenen.
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // Globaler Sofortsperre-Hotkey (Issue #17, Desktop-only): Trigger einmalig
  // hinterlegen (SecurityPanel registriert bei Einstellungsänderungen selbst
  // neu, kennt aber den Sperrzustand nicht) und initial registrieren --
  // lockHotkey.ts liest die Einstellung selbst aus localStorage und ist auf
  // Android ein No-op (Plugin existiert dort nicht). Wirkt NUR im
  // entsperrten Zustand -- im gesperrten Zustand (LockScreen) bewusst ein
  // No-op, ein versehentlicher Druck dort löst nichts aus.
  useEffect(() => {
    setLockHotkeyTrigger(() => {
      if (!lockedRef.current) doLock();
    });
    void applyLockHotkey();
  }, []);

  // Tray-Menü "Sofort sperren" (tray.rs): sendet ein Event ans Frontend statt
  // direkt zu sperren -- die App bleibt beim Verstecken ins Tray gemountet
  // (Tray-Bestandsverhalten), der Listener läuft deshalb unabhängig vom
  // sichtbaren Fenster weiter. Anders als der Hotkey wirkt der Tray-Eintrag
  // UNABHÄNGIG vom Sperrzustand (Sperren einer bereits gesperrten DB ist
  // harmlos, s. crypto_lock) -- derselbe Pfad wie die AppMenu-Sofortsperre.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("brlog://lock", () => doLock())
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* Außerhalb einer echten Tauri-Webview (z. B. Tests) ignorieren. */
      });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-Lock bei Inaktivität (abschaltbar, Sentinel 0 = "nie", Issue #17) +
  // Sperren, sobald die App nicht mehr sichtbar ist (NICHT abschaltbar, ganz
  // eigener Mechanismus -- s. u.). Linux-Portierung (L3): ersetzt den
  // bisherigen Windows-spezifischen Weg über @tauri-apps/api/window
  // (onResized + isMinimized, das unter WebKitGTK/Linux nicht zuverlässig
  // dieselben Ereignisse liefert) durch die plattformneutrale
  // Page-Visibility-API. document.hidden wird true bei Minimieren, Tab-/
  // Fenster-Wechsel, Bildschirmsperre -- unter Windows, Linux und später
  // Android gleichermaßen, ganz ohne fenster-spezifisches Tauri-Plugin.
  // Bewusst OHNE Gnadenfrist auf dem DESKTOP: Sperren erfolgt dort sofort
  // beim Verstecken (strengere, sicherere Variante -- unverändert seit
  // Issue #17/Task 5). Auf ANDROID ist seit Issue #17/Task 7 (Nutzer-
  // Entscheid 2026-07-19) eine opt-in-Karenzzeit verfügbar (SecurityPanel,
  // "Sperren beim Verlassen der App", Default weiterhin "Sofort" ==
  // dasselbe strenge Verhalten): kurzes Wechseln in eine andere App (z. B.
  // eine Weiterleitung/Share-Dialog) muss dort nicht zwingend sofort
  // sperren. Die reine, testbare Zustandslogik der Karenz liegt in
  // lockDelay.ts (createLockDelay) -- hier nur die Verdrahtung; der
  // `mobile`-Zweig unten ist rein additiv, der Desktop-Zweig (`else doLock()`)
  // bleibt textidentisch zum bisherigen, unconditional laufenden Verhalten.
  //
  // Sentinel 0 (SecurityPanel, "Nie automatisch sperren"): startIdleTimer(0)
  // ist ein reines No-op (kein Timer, keine Aktivitäts-Listener, s. auth.ts)
  // -- dieser Effekt braucht dafür KEINE eigene Fallunterscheidung. Der
  // visibilitychange-Handler bleibt davon komplett unberührt und läuft immer
  // (unconditional, unabhängig von autoLockMin): "nie" schaltet bewusst NUR
  // die Inaktivitäts-Sperre ab, nicht die Sperre beim Verstecken/Minimieren
  // -- zwei getrennte, unabhängig konfigurierbare Sicherheitsmechanismen.
  useEffect(() => {
    if (!ready || locked) return;
    const stopIdle = startIdleTimer(autoLockMin, doLock);
    const lockDelay = mobile
      ? createLockDelay({ delaySec: androidLockDelaySec, onLock: doLock })
      : null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (lockDelay) lockDelay.onHidden();
        else doLock();
      } else {
        lockDelay?.onVisible();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopIdle();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lockDelay?.dispose();
    };
  }, [ready, locked, autoLockMin, mobile, androidLockDelaySec]);

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
  // (Overrides erben sie, ihre eigene Zeile trägt keine) -- s. resolveOverride.
  const openOccurrence = async (occ: Occurrence) => {
    try {
      // Master parallel zum Override laden -- die parentId ist schon vor dem
      // ersten Query bekannt, sequentiell zahlte jedes Öffnen einer
      // bearbeiteten Instanz zwei hintereinander gereihte Roundtrips.
      const [row, master] = await Promise.all([
        getAppointment(occ.appointment.id),
        occ.appointment.parentId
          ? getAppointment(occ.appointment.parentId)
          : Promise.resolve(null),
      ]);
      if (!row) {
        showToast("Termin nicht gefunden");
        bumpAppointments();
        return;
      }
      const full = resolveOverride(row, master);
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
    bumpAppointments();
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
  // Die Termin-Builder (plainAppointment, buildOverrideDraft, buildSplitDraft,
  // truncatedMaster, duplicateAppointment) leben als getestete pure Funktionen
  // in lib/appointments.ts.

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
        bumpAppointments();
        return;
      }
      // "Diesen und alle folgenden" auf der ERSTEN Instanz umfasst die ganze
      // Serie. Ein Split/Kürzen würde den Master mit UNTIL vor DTSTART
      // zurücklassen: 0 sichtbare Instanzen, aber weiterhin in DB, Suche,
      // Backup und ICS-Export -- eine nie mehr löschbare Datenleiche.
      const coversWholeSeries = scope === "following" && anchor <= master.startDate;
      if (mode === "edit") {
        setFormDirty(false);
        if (scope === "all" || coversWholeSeries) {
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
          bumpAppointments();
          showToast("Termin gelöscht");
        } else if (coversWholeSeries) {
          await deleteAppointment(masterId);
          setModal(null);
          bumpAppointments();
          showToast("Serie gelöscht");
        } else {
          await truncateSeries({ master: truncatedMaster(master, anchor), anchor });
          setModal(null);
          bumpAppointments();
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
      bumpAppointments();
      showToast("Termin gelöscht");
    } catch (e) {
      showToast(toUserMessage(e));
    }
  };
  const handleApptDuplicate = (appt: AppointmentFullItem) => {
    setFormDirty(false);
    setModal({
      type: "apptForm",
      appointment: duplicateAppointment(appt, todayIso()),
    });
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
      <div className="flex h-full items-center justify-center text-secondary-ink">
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
      <div className="flex h-full items-center justify-center text-secondary-ink">
        <div className="max-w-md space-y-4 p-4 text-center">
          <div>
            <p className="font-medium text-danger-ink">
              Fehler beim Start
            </p>
            <p className="mt-1 break-all text-sm">{initError}</p>
          </div>

          <button
            type="button"
            onClick={retryInit}
            disabled={retrying}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {retrying ? "Wird erneut versucht…" : "Erneut versuchen"}
          </button>

          {initDbPath && (
            <div className="rounded bg-surface-inset p-2 text-left text-xs text-secondary-ink">
              <div className="font-medium">Datenbank-Datei:</div>
              <div className="mt-1 break-all">{initDbPath}</div>
            </div>
          )}

          <p className="text-left text-xs text-secondary-ink">
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
      <div className="flex h-full items-center justify-center text-secondary-ink">
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
      {/* Verpasste Termin-Erinnerungen (App war zu / DB gesperrt, als sie
          fällig wurden) -- Banner-Muster des Erfassungs-Hinweises darunter. */}
      {missedReminders.length > 0 && (
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-warning-banner-line bg-warning-banner px-4 py-2 text-sm text-warning-banner-ink">
          <div>
            <span className="font-medium">
              {missedReminders.length === 1
                ? "1 verpasste Termin-Erinnerung:"
                : `${missedReminders.length} verpasste Termin-Erinnerungen:`}
            </span>{" "}
            {missedReminders
              .slice(0, 3)
              .map((c) => `${c.title} (${reminderBody(c, todayIso())})`)
              .join(" · ")}
            {missedReminders.length > 3 && " · …"}
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-warning-banner-hover"
            onClick={dismissMissedReminders}
          >
            Ausblenden
          </button>
        </div>
      )}
      {showReminder && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-warning-banner-line bg-warning-banner px-4 py-2 text-sm text-warning-banner-ink">
          <span>
            Letzter Eintrag vor {daysSinceLastEntry} Tagen ({formatDateDe(lastEntryDate!)}
            ). Zeitnahe Erfassung stärkt den Nachweis.
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-warning-banner-hover"
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

        {/* Kein `pb-[4.5rem]` mehr auf Android: BottomNav ist kein `fixed`-
            Overlay mehr, sondern ein normaler Flex-Bruder unterhalb dieses
            Wrappers (s. Kommentar in BottomNav.tsx) -- `main` endet dadurch
            bereits von selbst oberhalb der Leiste, eine Polster-Reservierung
            entfällt. */}
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
              mobile={mobile}
            />
          )}
          {view === "auswertung" && <StatsView reloadKey={reloadKey} />}
          {view === "daten" && (
            <DataView
              reloadKey={reloadKey}
              mobile={mobile}
              onChanged={() => {
                loadTags();
                loadAllTags();
                // Backup-/ICS-Import läuft über diesen Handler und kann
                // Termine verändern -- Termin-Snapshot mit aktualisieren.
                bumpAppointments();
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
              ? "fixed inset-0 z-overlay flex items-stretch justify-center overflow-y-auto bg-overlay"
              : "fixed inset-0 z-overlay flex items-start justify-center overflow-y-auto bg-overlay p-4"
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
                ? "min-h-full w-full rounded-none bg-surface p-4 shadow-xl outline-none"
                : // "Über BR-Log" ist bewusst ein kleines Modal (siehe Auftrag),
                  // Formular/Detail bleiben beim gewohnten max-w-2xl -- selber
                  // Container/Mechanismus, nur die Breite variiert mit dem
                  // Modal-Typ. "Einstellungen" bekommt seit der Desktop-
                  // Master-Detail-Ansicht (Design-Handoff #28, "Di") mehr
                  // Breite (max-w-4xl): die Abschnittsliste links (12rem, s.
                  // .settings-layout in styles.css) kommt bei max-w-2xl sonst
                  // zulasten des Detailbereichs, der dann kaum breiter wäre
                  // als in der einspaltigen Stapelung zuvor.
                  "my-4 w-full rounded-lg bg-surface p-4 shadow-xl outline-none " +
                  (modal.type === "about"
                    ? "max-w-sm"
                    : modal.type === "settings"
                      ? "max-w-4xl"
                      : "max-w-2xl")
            }
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "form" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-primary-ink"
                >
                  Eintrag
                </h2>
                <EntryForm
                  entry={modal.entry}
                  tags={allTags}
                  dateInputRef={dateFieldRef}
                  onSaved={handleModalSaved}
                  onCancel={requestCloseModal}
                  onDraftChange={(draft, dirty) => {
                    setFormDirty(dirty);
                    draftRef.current = draft;
                  }}
                />
              </>
            )}
            {modal.type === "detail" && (
              <>
                <h2
                  id="entry-modal-heading"
                  className="mb-3 text-base font-semibold text-primary-ink"
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
                  className="mb-3 text-base font-semibold text-primary-ink"
                >
                  Termin
                </h2>
                <AppointmentForm
                  appointment={modal.appointment}
                  tags={allTags}
                  titleInputRef={dateFieldRef}
                  onSaved={handleApptSaved}
                  onCancel={requestCloseModal}
                  onDraftChange={(draft, dirty) => {
                    setFormDirty(dirty);
                    draftRef.current = draft;
                  }}
                  saveAction={modal.saveAction}
                  contextHint={modal.contextHint}
                />
              </>
            )}
            {/* Termin-Details (Design-Handoff #27, 1g): "Schließen" ist hier
                das X im Modal-Kopf statt eines Footer-Buttons -- die übrigen
                vier Fußzeilen-Aktionen (Zeit buchen/Duplizieren/Löschen/
                Bearbeiten) brachen auf 360px sonst zu einem gedrängten Block
                um. Folgt damit demselben X-Muster wie Einstellungen/Über
                weiter unten (Begründung dort). */}
            {modal.type === "apptDetail" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2
                    id="entry-modal-heading"
                    className="text-base font-semibold text-primary-ink"
                  >
                    Termin-Details
                  </h2>
                  <button
                    type="button"
                    aria-label="Schließen"
                    title="Schließen"
                    onClick={() => setModal(null)}
                    className="-my-2 -mr-2 flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-lg text-secondary-ink hover:bg-surface-2"
                  >
                    <Icon name="x" size={20} />
                  </button>
                </div>
                <AppointmentDetail
                  appointment={modal.appointment}
                  occurrence={modal.occ}
                  onEdit={() => requestApptEdit(modal.appointment, modal.occ)}
                  onDelete={() => requestApptDeleteSmart(modal.appointment, modal.occ)}
                  onDuplicate={() => handleApptDuplicate(modal.appointment)}
                  onBookTime={() =>
                    bookTimeFromAppointment(modal.appointment, modal.occ)
                  }
                />
              </>
            )}
            {/* Schließen-Muster der beiden AppMenu-Modals: X-Button im
                Modal-Kopf (statt Footer-Button wie im Detail-Modal). Grund:
                Einstellungen ist lang und scrollt -- ein Footer-Button wäre
                beim Öffnen unsichtbar (unterhalb des Folds), das X oben ist
                sofort als Ausweg erkennbar. Auf Android (fullscreen-nah, kein
                sichtbarer Backdrop) ist es der einzige sichtbare Ausweg neben
                der System-Zurück-Taste. Das Eintrags-Detail-Modal (EntryDetail)
                behält seine Footer-Aktionsleiste (dort ist Schließen Teil
                echter Aktionen, siehe #27 1d -- außerhalb dieses Auftrags).
                Das X ist zudem das erste fokussierbare Element -> die
                Fokusfalle (useModalFocusTrap) fokussiert es beim Öffnen. */}
            {modal.type === "settings" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2
                    id="entry-modal-heading"
                    className="text-base font-semibold text-primary-ink"
                  >
                    Einstellungen
                  </h2>
                  <button
                    type="button"
                    aria-label="Schließen"
                    title="Schließen"
                    onClick={requestCloseModal}
                    className="-my-2 -mr-2 flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-lg text-secondary-ink hover:bg-surface-2"
                  >
                    <Icon name="x" size={20} />
                  </button>
                </div>
                <SettingsPanel
                  onLockNow={doLock}
                  onAutoLockChanged={setAutoLockMin}
                  onAndroidLockDelayChanged={setAndroidLockDelaySec}
                  onBlurOnFocusLossChanged={setBlurOnFocusLossEnabledState}
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
                    className="-my-2 -mr-2 ml-auto flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-lg text-secondary-ink hover:bg-surface-2"
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
          className="fixed inset-0 z-modal flex items-center justify-center bg-overlay p-4"
          onClick={() => setConfirmDiscard(null)}
        >
          <div
            ref={confirmRef}
            role="dialog"
            aria-modal="true"
            aria-label={confirmDiscard.message}
            tabIndex={-1}
            className="w-full max-w-sm rounded-lg bg-surface p-4 shadow-xl outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-primary-ink">
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
                className="rounded bg-danger px-4 py-2 text-sm font-medium text-on-primary hover:bg-danger-hover"
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
              ? "fixed bottom-20 left-1/2 z-toast -translate-x-1/2 rounded-full bg-surface-inverse px-4 py-2 text-sm text-on-primary shadow-lg"
              : "fixed bottom-4 left-1/2 z-toast -translate-x-1/2 rounded-full bg-surface-inverse px-4 py-2 text-sm text-on-primary shadow-lg"
          }
        >
          {toast}
        </div>
      )}
    </div>
  );
}
