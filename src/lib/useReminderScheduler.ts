// React-Verdrahtung des Erinnerungs-Orchestrators (reminderOrchestrator.ts):
// dünne, selbst NICHT unit-getestete Wiring-Schicht -- baut die echten Ports
// aus dem DB-Repository und dem Notification-Plugin und verdrahtet sie mit
// den React-Effekten (Snapshot-Aufbau bei ready/apptReloadKey-Wechsel,
// 30-s-Loop ab Mount). Die getestete Logik liegt vollständig im Orchestrator
// (siehe reminderOrchestrator.test.ts).

import { useEffect, useState } from "react";
import {
  cancel as cancelNotifications,
  createChannel,
  Importance,
  isPermissionGranted,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  cleanupFiredBefore,
  listAppointmentsRange,
  listFiredReminders,
  markReminderFired,
} from "../db/repository";
import {
  createReminderOrchestrator,
  type NotificationPort,
  type ReminderDbPort,
  type ScheduledStorePort,
} from "./reminderOrchestrator";
import {
  loadScheduledRefs,
  notificationContent,
  saveScheduledRefs,
  type ReminderCandidate,
} from "./reminderScheduler";

const dbPort: ReminderDbPort = {
  listAppointmentsRange,
  listFiredReminders,
  markReminderFired,
  cleanupFiredBefore,
};

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false; // Plugin nicht verfügbar -> Erinnerungen bleiben stumm
  }
}

const notificationPort: NotificationPort = {
  ensurePermission: ensureNotificationPermission,
  createChannel: () =>
    createChannel({
      id: "termine",
      name: "Termin-Erinnerungen",
      importance: Importance.High,
    }),
  cancel: (ids) => cancelNotifications(ids),
  notifyNow: (c, todayIso) => {
    sendNotification(notificationContent(c, todayIso));
  },
  scheduleAt: (id, c, todayIso) => {
    sendNotification({
      id,
      channelId: "termine",
      ...notificationContent(c, todayIso),
      // allowWhileIdle: auch im Doze-Modus zustellen (Minuten-Toleranz bleibt
      // möglich, exakte Alarme sind ab API 31 restriktiv).
      schedule: Schedule.at(new Date(c.dueMs), false, true),
    });
  },
};

const scheduledStorePort: ScheduledStorePort = {
  load: loadScheduledRefs,
  save: saveScheduledRefs,
};

export function useReminderScheduler(args: {
  ready: boolean;
  mobile: boolean;
  apptReloadKey: number;
}): {
  missedReminders: ReminderCandidate[];
  dismissMissedReminders: () => void;
} {
  const [missedReminders, setMissedReminders] = useState<ReminderCandidate[]>([]);
  // Eigener Zähler: der 30-s-Loop stößt hierüber einen Neuaufbau des Snapshots
  // an (rollendes Fenster im Dauerbetrieb), ohne dass das dem globalen
  // reloadKey/apptReloadKey der App aufgezwungen werden muss.
  const [snapshotRefresh, setSnapshotRefresh] = useState(0);

  const [orchestrator] = useState(() =>
    createReminderOrchestrator({
      mobile: args.mobile,
      db: dbPort,
      notifications: notificationPort,
      scheduledStore: scheduledStorePort,
      onMissedChange: setMissedReminders,
      requestSnapshotRefresh: () => setSnapshotRefresh((n) => n + 1),
    })
  );

  // readyRef-Äquivalent: der Intervall-Callback (tick) läuft auch während der
  // Sperre weiter und darf dann nicht in die DB schreiben.
  useEffect(() => {
    orchestrator.setReady(args.ready);
  }, [orchestrator, args.ready]);

  // Snapshot laden: nächste Kandidaten + Feuer-Protokoll; dabei Pending-
  // Markierungen aus einer Sperr-Phase nachtragen und Verpasste für den
  // Nachhol-Banner einsammeln (siehe refreshSnapshot im Orchestrator, inkl.
  // Race-Schutz über die interne Aufruf-Generation).
  useEffect(() => {
    if (!args.ready) return;
    void orchestrator.refreshSnapshot();
  }, [orchestrator, args.ready, args.apptReloadKey, snapshotRefresh]);

  // 30-s-Prüf-Loop: läuft ab Mount durchgehend (auch bei gesperrter DB, aus
  // dem In-Memory-Snapshot). Fällige feuern genau einmal (firedKeys sofort).
  useEffect(() => {
    const id = window.setInterval(() => orchestrator.tick(), 30_000);
    return () => window.clearInterval(id);
  }, [orchestrator]);

  return {
    missedReminders,
    dismissMissedReminders: () => orchestrator.dismissMissed(),
  };
}
