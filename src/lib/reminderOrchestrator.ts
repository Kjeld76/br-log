// Erinnerungs-Orchestrator: die zustandsbehaftete Steuerung des Termin-
// Erinnerungssystems (Snapshot-Aufbau, 30-s-Loop, Pending-Flush bei
// gesperrter DB, Android-System-Planung mit Doppelzustellungs-Schutz) --
// 1:1 aus App.tsx ausgelagert (GitHub-Issue #6), damit sie ohne React/jsdom
// testbar ist (Vitest läuft mit environment: "node"). Die reinen Selektoren
// und Konstanten bleiben in reminderScheduler.ts; dieses Modul konsumiert sie
// über injizierte Ports (DB/Notifications/Storage) statt echter Plugins.

import { addDays, format } from "date-fns";
import type { AppointmentListItem, ReminderFired } from "../types";
import {
  buildReminderCandidates,
  firedKey,
  firedKeySetFrom,
  notificationIdFor,
  selectDue,
  selectMissed,
  selectToSchedule,
  MISSED_LOOKBACK_DAYS,
  REMINDER_HORIZON_DAYS,
  SNAPSHOT_MAX_AGE_MS,
  type ReminderCandidate,
  type ScheduledRef,
} from "./reminderScheduler";

export interface ReminderDbPort {
  listAppointmentsRange(from: string, to: string): Promise<AppointmentListItem[]>;
  listFiredReminders(from: string): Promise<ReminderFired[]>;
  markReminderFired(f: ReminderFired): Promise<void>;
  cleanupFiredBefore(iso: string): Promise<void>;
}

export interface NotificationPort {
  ensurePermission(): Promise<boolean>;
  createChannel(): Promise<void>; // Android-Kanal "termine"
  cancel(ids: number[]): Promise<void>;
  notifyNow(c: ReminderCandidate, todayIso: string): void;
  /** Plant eine System-Notification (Android); wirft bei Fehler. */
  scheduleAt(id: number, c: ReminderCandidate, todayIso: string): void;
}

export interface ScheduledStorePort {
  load(): ScheduledRef[];
  save(refs: ScheduledRef[]): void;
}

export interface ReminderOrchestrator {
  setReady(ready: boolean): void;
  /** Snapshot-Aufbau: Pending-Flush, Kandidaten, firedKeys-MERGE, Verpasste,
      Cleanup (einmalig), Android-Planung bzw. Desktop-Permission-Warmup. */
  refreshSnapshot(): Promise<void>;
  /** 30-s-Loop-Body: Stale-Erkennung + fällige feuern (genau einmal). */
  tick(): void;
  dismissMissed(): void;
}

export function createReminderOrchestrator(deps: {
  mobile: boolean;
  db: ReminderDbPort;
  notifications: NotificationPort;
  scheduledStore: ScheduledStorePort;
  onMissedChange(missed: ReminderCandidate[]): void;
  requestSnapshotRefresh(): void;
  now?: () => number; // Default Date.now; Tests injizieren feste Zeit
}): ReminderOrchestrator {
  const now = deps.now ?? Date.now;

  // Zustand statt React-Refs (App.tsx-Ursprung): der Snapshot muss den
  // Auto-Lock ÜBERLEBEN (App zeigt dann den LockScreen, bleibt aber
  // gemountet) und darf keine Re-Renders auslösen. Enthält nur öffentliche
  // Felder (Titel/Zeit), nie BR-Geheimnis.
  let candidates: ReminderCandidate[] = [];
  let firedKeys = new Set<string>();
  // Feuer-Markierungen, die bei gesperrter DB anfielen -> Flush nach Unlock.
  let pendingFired: ReminderFired[] = [];
  let ready = false;
  let cleanupDone = false;
  // Alter des Kandidaten-Snapshots: der 30-s-Loop stößt bei entsperrter App
  // periodisch einen Neuaufbau an, damit das Fenster im Dauerbetrieb mitrollt
  // (ohne reloadKey-Bump veraltete es sonst unbegrenzt).
  let snapshotLoadedAt = 0;
  // Android: Schlüssel der system-geplanten Notifications (Rolling Window).
  // Der In-App-Loop überspringt sie (Doppel-Zustellungs-Schutz), und beim
  // Start gelten vergangene system-geplante als zugestellt (kein Banner).
  let scheduledKeys = new Set(deps.scheduledStore.load().map((r) => r.key));
  // Letzte an onMissedChange gemeldete Liste -- dismissMissed markiert genau
  // diese als behandelt (entspricht dem bisherigen React-State missedReminders).
  let lastMissed: ReminderCandidate[] = [];
  // Race-Schutz: ein überholter refreshSnapshot (dessen DB-Read noch läuft,
  // während ein neuerer bereits gestartet ist) darf den frischeren Zustand
  // nicht überschreiben -- Ersatz für das active-Flag-Effekt-Cleanup aus
  // App.tsx.
  let generation = 0;

  // Feuer-Markierung persistieren; bei gesperrter DB in den Pending-Puffer.
  const recordFired = (c: ReminderCandidate) => {
    firedKeys.add(firedKey(c));
    const f: ReminderFired = {
      appointmentId: c.appointmentId,
      reminderId: c.reminderId,
      occurrenceAnchor: c.anchor,
      firedAt: new Date(now()).toISOString(),
    };
    if (ready) {
      void deps.db.markReminderFired(f).catch(() => pendingFired.push(f));
    } else {
      pendingFired.push(f);
    }
  };

  const notifyReminder = async (c: ReminderCandidate) => {
    try {
      if (!(await deps.notifications.ensurePermission())) return;
      // "Heute" relativ zum FEUER-Tag (bei Live-Feuern = jetzt).
      deps.notifications.notifyNow(c, format(new Date(c.dueMs), "yyyy-MM-dd"));
    } catch (e) {
      console.warn("Termin-Erinnerung konnte nicht angezeigt werden.", e);
    }
  };

  // Android: die nächsten Erinnerungen als ECHTE System-Notifications planen
  // (feuern auch bei geschlossener App). Alte Planungen werden storniert,
  // dann das Rolling Window neu aufgebaut (Neuplanung bei jedem Laden).
  const planAndroidNotifications = async () => {
    try {
      if (!(await deps.notifications.ensurePermission())) {
        // Referenzen NICHT löschen: ensurePermission liefert auch bei
        // transienten Plugin-Fehlern false. Ohne die gespeicherten IDs wären
        // bereits system-geplante Alarme nie mehr stornierbar, und ohne die
        // Schlüssel feuerte der In-App-Loop zusätzlich zur System-
        // Notification (Doppel-Zustellung).
        scheduledKeys = new Set(deps.scheduledStore.load().map((r) => r.key));
        return;
      }
      try {
        await deps.notifications.createChannel();
      } catch {
        // Channel existiert bereits o. ä. -- unkritisch.
      }
      const old = deps.scheduledStore.load();
      if (old.length > 0) {
        try {
          await deps.notifications.cancel(old.map((r) => r.id));
        } catch {
          // Bereits zugestellte/abgelaufene IDs lassen sich nicht stornieren.
        }
      }
      const toSchedule = selectToSchedule(candidates, firedKeys, now());
      const refs: ScheduledRef[] = [];
      for (const c of toSchedule) {
        const key = firedKey(c);
        const id = notificationIdFor(key);
        try {
          deps.notifications.scheduleAt(
            id,
            c,
            format(new Date(c.dueMs), "yyyy-MM-dd")
          );
          refs.push({ key, id });
        } catch (e) {
          console.warn("Erinnerung konnte nicht geplant werden.", e);
        }
      }
      deps.scheduledStore.save(refs);
      // Union aus alten und neuen Schlüsseln: ein bereits zugestellter
      // Kandidat, dessen dueMs noch im Live-Fenster liegt, wird nicht neu
      // geplant -- ohne seinen alten Schlüssel verlöre er den Doppel-
      // Zustellungs-Schutz und erschiene zusätzlich als In-App-Notification.
      scheduledKeys = new Set([
        ...old.map((r) => r.key),
        ...refs.map((r) => r.key),
      ]);
    } catch (e) {
      console.warn("Planung der Android-Erinnerungen fehlgeschlagen.", e);
    }
  };

  return {
    setReady(r: boolean) {
      ready = r;
    },

    // Snapshot laden: nächste Kandidaten + Feuer-Protokoll; dabei Pending-
    // Markierungen aus einer Sperr-Phase nachtragen und Verpasste für den
    // Nachhol-Banner einsammeln.
    async refreshSnapshot() {
      const myGeneration = ++generation;
      try {
        const pending = pendingFired;
        pendingFired = [];
        for (const f of pending) {
          try {
            await deps.db.markReminderFired(f);
          } catch (e) {
            // Nicht durchschreibbar (z. B. Termin inzwischen gelöscht -> die
            // FK-Prüfung greift trotz INSERT OR IGNORE): Markierung
            // verwerfen, aber den Snapshot-Aufbau nicht abbrechen -- sonst
            // fällt das gesamte Erinnerungssystem für diesen Zyklus aus.
            console.warn("Feuer-Markierung konnte nicht gespeichert werden.", e);
          }
        }
        const from = format(
          addDays(new Date(now()), -MISSED_LOOKBACK_DAYS),
          "yyyy-MM-dd"
        );
        // Großzügiger Horizont: Der 30-s-Loop feuert im Tray-/Sperr-Betrieb
        // nur aus diesem Snapshot -- mit +8 Tagen versiegten Erinnerungen,
        // sobald die App länger als eine Woche nicht entsperrt wurde, und
        // "1 Woche vorher"-Erinnerungen für fernere Termine fehlten ganz.
        const to = format(
          addDays(new Date(now()), REMINDER_HORIZON_DAYS),
          "yyyy-MM-dd"
        );
        const [items, fired] = await Promise.all([
          deps.db.listAppointmentsRange(from, to),
          deps.db.listFiredReminders(from),
        ]);
        if (myGeneration !== generation) return;
        candidates = buildReminderCandidates(items, from, to);
        // MERGEN statt ersetzen: der 30-s-Loop kann zwischen dem DB-Read und
        // dieser Zuweisung gefeuert haben (recordFired schreibt die DB nur
        // fire-and-forget) -- ein komplett ersetztes Set verlöre den frischen
        // Key und die Notification erschiene beim nächsten Tick doppelt.
        firedKeys = new Set([...firedKeySetFrom(fired), ...firedKeys]);
        snapshotLoadedAt = now();
        const missedAll = selectMissed(candidates, firedKeys, now());
        // Android: was system-geplant war und inzwischen fällig ist, hat das
        // System zugestellt -> still als gefeuert markieren, kein Banner.
        if (deps.mobile) {
          for (const c of missedAll) {
            if (scheduledKeys.has(firedKey(c))) recordFired(c);
          }
        }
        lastMissed = deps.mobile
          ? missedAll.filter((c) => !scheduledKeys.has(firedKey(c)))
          : missedAll;
        deps.onMissedChange(lastMissed);
        if (!cleanupDone) {
          cleanupDone = true;
          void deps.db
            .cleanupFiredBefore(format(addDays(new Date(now()), -90), "yyyy-MM-dd"))
            .catch(() => {
              /* Aufräumen ist Best-effort. */
            });
        }
        if (deps.mobile) {
          await planAndroidNotifications();
        } else if (candidates.length > 0) {
          void deps.notifications.ensurePermission();
        }
      } catch (e) {
        console.warn("Termin-Erinnerungen konnten nicht geladen werden.", e);
      }
    },

    // 30-s-Prüf-Loop-Body: läuft ab Mount durchgehend (auch bei gesperrter
    // DB, aus dem In-Memory-Snapshot). Fällige feuern genau einmal
    // (firedKeys sofort).
    tick() {
      // Snapshot bei entsperrter App periodisch neu aufbauen (rollendes
      // Fenster); bei gesperrter DB geht es nicht -- dafür ist der Horizont
      // (REMINDER_HORIZON_DAYS) großzügig bemessen.
      if (
        ready &&
        snapshotLoadedAt > 0 &&
        now() - snapshotLoadedAt > SNAPSHOT_MAX_AGE_MS
      ) {
        snapshotLoadedAt = now(); // kein Doppel-Trigger
        deps.requestSnapshotRefresh();
      }
      const due = selectDue(candidates, firedKeys, now());
      for (const c of due) {
        // Android: system-geplante Kandidaten zeigt das System selbst an --
        // hier nur als gefeuert markieren (Doppel-Zustellungs-Schutz).
        const systemScheduled = deps.mobile && scheduledKeys.has(firedKey(c));
        recordFired(c);
        if (!systemScheduled) void notifyReminder(c);
      }
    },

    // Nachhol-Banner schließen = alle als behandelt markieren.
    dismissMissed() {
      const items = lastMissed;
      lastMissed = [];
      deps.onMissedChange([]);
      for (const c of items) recordFired(c);
    },
  };
}
