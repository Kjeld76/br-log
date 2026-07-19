import { describe, expect, it } from "vitest";
import type { AppointmentListItem, ReminderFired } from "../types";
import {
  createReminderOrchestrator,
  type NotificationPort,
  type ReminderDbPort,
  type ScheduledStorePort,
} from "./reminderOrchestrator";
import { firedKey, type ReminderCandidate, type ScheduledRef } from "./reminderScheduler";

function appt(overrides: Partial<AppointmentListItem> = {}): AppointmentListItem {
  return {
    id: "a1",
    title: "BR-Sitzung",
    location: "",
    description: "",
    isAllDay: false,
    startDate: "2026-07-20",
    startTime: "10:00",
    endDate: "2026-07-20",
    endTime: "11:00",
    isImportant: false,
    color: null,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceAnchor: null,
    icsUid: null,
    icsSequence: 0,
    tagIds: [],
    tagLabels: [],
    reminders: [{ id: "r0", minutesBefore: 0 }],
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

const ms = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

function makeNow(start: number) {
  let value = start;
  return {
    now: () => value,
    set: (v: number) => {
      value = v;
    },
  };
}

// notifyReminder (im Orchestrator) ist fire-and-forget async (ensurePermission
// wird erst noch abgewartet) -- ein Makrotask-Tick garantiert, dass die
// Mikrotask-Queue vollständig abgearbeitet ist, bevor notifyNowCalls geprüft wird.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeDb(opts: {
  items?: AppointmentListItem[];
  fired?: ReminderFired[];
  listFiredReminders?: ReminderDbPort["listFiredReminders"];
  markReminderFired?: ReminderDbPort["markReminderFired"];
}): { db: ReminderDbPort; markFiredCalls: ReminderFired[]; cleanupCalls: string[] } {
  const markFiredCalls: ReminderFired[] = [];
  const cleanupCalls: string[] = [];
  const db: ReminderDbPort = {
    listAppointmentsRange: async () => opts.items ?? [],
    listFiredReminders: opts.listFiredReminders ?? (async () => opts.fired ?? []),
    markReminderFired:
      opts.markReminderFired ??
      (async (f) => {
        markFiredCalls.push(f);
      }),
    cleanupFiredBefore: async (iso) => {
      cleanupCalls.push(iso);
    },
  };
  return { db, markFiredCalls, cleanupCalls };
}

function makeNotifications(permission = true): {
  notifications: NotificationPort;
  notifyNowCalls: { c: ReminderCandidate; todayIso: string }[];
  scheduleAtCalls: { id: number; c: ReminderCandidate; todayIso: string }[];
  cancelCalls: number[][];
  createChannelCalls: number[];
} {
  const notifyNowCalls: { c: ReminderCandidate; todayIso: string }[] = [];
  const scheduleAtCalls: { id: number; c: ReminderCandidate; todayIso: string }[] = [];
  const cancelCalls: number[][] = [];
  const createChannelCalls: number[] = [];
  const notifications: NotificationPort = {
    ensurePermission: async () => permission,
    createChannel: async () => {
      createChannelCalls.push(1);
    },
    cancel: async (ids) => {
      cancelCalls.push(ids);
    },
    notifyNow: (c, todayIso) => {
      notifyNowCalls.push({ c, todayIso });
    },
    scheduleAt: (id, c, todayIso) => {
      scheduleAtCalls.push({ id, c, todayIso });
    },
  };
  return { notifications, notifyNowCalls, scheduleAtCalls, cancelCalls, createChannelCalls };
}

function makeStore(initial: ScheduledRef[] = []): {
  store: ScheduledStorePort;
  saveCalls: ScheduledRef[][];
  setRefs: (r: ScheduledRef[]) => void;
} {
  let refs = initial;
  const saveCalls: ScheduledRef[][] = [];
  const store: ScheduledStorePort = {
    load: () => refs,
    save: (r) => {
      saveCalls.push(r);
      refs = r;
    },
  };
  return { store, saveCalls, setRefs: (r) => (refs = r) };
}

const NOW = ms(2026, 7, 20, 10, 0);

describe("createReminderOrchestrator", () => {
  it("feuert einen fälligen Kandidaten genau einmal (2. tick still) und schreibt ihn in die DB", async () => {
    const nowBox = makeNow(NOW);
    const { db, markFiredCalls } = makeDb({ items: [appt()] });
    const { notifications, notifyNowCalls } = makeNotifications();
    const { store } = makeStore();
    const orch = createReminderOrchestrator({
      mobile: false,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot();

    orch.tick();
    await flush();
    expect(markFiredCalls).toHaveLength(1);
    expect(notifyNowCalls).toHaveLength(1);

    orch.tick();
    await flush();
    expect(markFiredCalls).toHaveLength(1);
    expect(notifyNowCalls).toHaveLength(1);
  });

  it("puffert Feuer-Markierungen bei ready=false; ein Flush-Fehler bricht den Snapshot-Aufbau nicht ab", async () => {
    const nowBox = makeNow(NOW);
    let markFiredCalls = 0;
    const db: ReminderDbPort = {
      listAppointmentsRange: async () => [appt()],
      listFiredReminders: async () => [],
      markReminderFired: async () => {
        markFiredCalls++;
        throw new Error("DB gesperrt");
      },
      cleanupFiredBefore: async () => {},
    };
    const { notifications } = makeNotifications();
    const { store } = makeStore();
    const missedChanges: ReminderCandidate[][] = [];
    const orch = createReminderOrchestrator({
      mobile: false,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: (m) => missedChanges.push(m),
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    // ready bleibt zunächst false (Default).
    await orch.refreshSnapshot();
    orch.tick(); // feuert -> Pending-Puffer statt DB (ready=false)
    expect(markFiredCalls).toBe(0);

    orch.setReady(true);
    await orch.refreshSnapshot(); // versucht den Puffer zu flushen -> DB wirft
    expect(markFiredCalls).toBe(1); // Flush wurde versucht
    expect(missedChanges.length).toBeGreaterThan(0); // Aufbau lief trotzdem zu Ende
  });

  it("mobil + system-geplanter Kandidat: tick markiert ihn als gefeuert, ruft aber KEIN notifyNow", async () => {
    const nowBox = makeNow(NOW);
    const candidate = appt();
    const key = firedKey({
      appointmentId: candidate.id,
      reminderId: candidate.reminders[0].id,
      anchor: candidate.startDate,
    });
    const { db, markFiredCalls } = makeDb({ items: [candidate] });
    const { notifications, notifyNowCalls } = makeNotifications();
    const { store } = makeStore([{ key, id: 42 }]);
    const orch = createReminderOrchestrator({
      mobile: true,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot(); // dueMs === NOW -> nicht "toSchedule" (nicht > now)

    orch.tick();
    expect(markFiredCalls).toHaveLength(1);
    expect(notifyNowCalls).toHaveLength(0);
  });

  it("refreshSnapshot meldet Verpasste; mobil + system-geplant wird still gefeuert und aus dem Banner gefiltert", async () => {
    const nowBox = makeNow(NOW);
    const missedCandidate = appt({
      id: "missed",
      startTime: "08:00", // 2 Std. vor NOW -> außerhalb Live-Fenster, innerhalb Lookback
      endTime: "08:30",
    });
    const scheduledMissed = appt({
      id: "scheduled-missed",
      startTime: "08:15",
      endTime: "08:45",
    });
    const scheduledKey = firedKey({
      appointmentId: scheduledMissed.id,
      reminderId: scheduledMissed.reminders[0].id,
      anchor: scheduledMissed.startDate,
    });
    const { db, markFiredCalls } = makeDb({
      items: [missedCandidate, scheduledMissed],
    });
    const { notifications } = makeNotifications();
    const { store } = makeStore([{ key: scheduledKey, id: 7 }]);
    const missedChanges: ReminderCandidate[][] = [];
    const orch = createReminderOrchestrator({
      mobile: true,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: (m) => missedChanges.push(m),
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot();

    const lastBanner = missedChanges[missedChanges.length - 1];
    expect(lastBanner.map((c) => c.appointmentId)).toEqual(["missed"]);
    // Der system-geplante Verpasste wurde still als gefeuert markiert (DB-Write).
    expect(
      markFiredCalls.some((f) => f.appointmentId === "scheduled-missed")
    ).toBe(true);
  });

  it("Android-Planung: Permission true storniert alte IDs, plant Kandidaten, speichert Refs und bildet die Union", async () => {
    const nowBox = makeNow(NOW);
    const future = appt({
      id: "future",
      startDate: "2026-07-21",
      startTime: "09:00",
      endTime: "09:30",
    });
    const { db } = makeDb({ items: [future] });
    const { notifications, scheduleAtCalls, cancelCalls, createChannelCalls } =
      makeNotifications(true);
    const { store, saveCalls } = makeStore([{ key: "alter-schluessel", id: 1 }]);
    const orch = createReminderOrchestrator({
      mobile: true,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot();

    expect(createChannelCalls).toHaveLength(1);
    expect(cancelCalls).toEqual([[1]]);
    expect(scheduleAtCalls).toHaveLength(1);
    expect(scheduleAtCalls[0].c.appointmentId).toBe("future");
    expect(saveCalls).toHaveLength(1);
    const savedKeys = saveCalls[0].map((r) => r.key);
    expect(savedKeys).toContain(firedKey(scheduleAtCalls[0].c));
    // Union aus alten und neuen Schlüsseln: der alte Schlüssel bleibt intern
    // erhalten (geprüft indirekt über tick(), siehe unten) -- hier zunächst
    // nur die neu geplante Referenz.
    expect(saveCalls[0]).toEqual([
      { key: firedKey(scheduleAtCalls[0].c), id: scheduleAtCalls[0].id },
    ]);
  });

  it("Android-Planung: Permission false storniert/plant nichts und rekonstruiert die Schlüssel aus dem Storage", async () => {
    const nowBox = makeNow(NOW);
    const future = appt({
      id: "future",
      startDate: "2026-07-21",
      startTime: "09:00",
      endTime: "09:30",
    });
    const { db, markFiredCalls } = makeDb({ items: [future] });
    const { notifications, notifyNowCalls, scheduleAtCalls, cancelCalls, createChannelCalls } =
      makeNotifications(false);
    const persistedKey = firedKey({
      appointmentId: future.id,
      reminderId: future.reminders[0].id,
      anchor: future.startDate,
    });
    const { store } = makeStore([{ key: persistedKey, id: 99 }]);
    const orch = createReminderOrchestrator({
      mobile: true,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot();

    expect(createChannelCalls).toHaveLength(0);
    expect(cancelCalls).toHaveLength(0);
    expect(scheduleAtCalls).toHaveLength(0);

    // Schlüssel wurden aus dem Storage rekonstruiert: der zukünftige, im
    // Storage bereits als "future" hinterlegte Kandidat gilt beim Fälligwerden
    // als system-geplant -- tick markiert ihn nur (DB), ohne notifyNow.
    nowBox.set(ms(2026, 7, 21, 9, 0));
    orch.tick();
    expect(markFiredCalls).toHaveLength(1);
    expect(notifyNowCalls).toHaveLength(0);
  });

  it("tick stößt requestSnapshotRefresh genau einmal an, wenn der Snapshot älter als SNAPSHOT_MAX_AGE_MS ist", async () => {
    const nowBox = makeNow(NOW);
    const { db } = makeDb({ items: [] });
    const { notifications } = makeNotifications();
    const { store } = makeStore();
    let refreshRequests = 0;
    const orch = createReminderOrchestrator({
      mobile: false,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {
        refreshRequests++;
      },
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot(); // stempelt snapshotLoadedAt = NOW

    nowBox.set(NOW + 12 * 3600_000 + 1);
    orch.tick();
    orch.tick();
    expect(refreshRequests).toBe(1);
  });

  it("firedKeys-MERGE: ein zwischen DB-Read und Zuweisung gefeuerter Key übersteht den Snapshot (kein Doppel-Feuern)", async () => {
    const nowBox = makeNow(NOW);
    const candidate = appt();
    let markFiredCalls = 0;
    // Holder statt `let orch` + Nachträglich-Zuweisung: db.listFiredReminders
    // muss orch.tick() aufrufen können, obwohl orch erst NACH db konstruiert
    // wird (zirkulärer Bezug) -- die Property wird einmalig befüllt.
    const holder: { orch?: ReturnType<typeof createReminderOrchestrator> } = {};
    const db: ReminderDbPort = {
      listAppointmentsRange: async () => [candidate],
      listFiredReminders: async () => {
        // Race: der 30-s-Loop feuert bereits, während dieser DB-Read noch
        // "unterwegs" ist (App.tsx-Kommentar: firedKeys MERGEN statt
        // ersetzen).
        holder.orch!.tick();
        return [];
      },
      markReminderFired: async () => {
        markFiredCalls++;
      },
      cleanupFiredBefore: async () => {},
    };
    const { notifications, notifyNowCalls } = makeNotifications();
    const { store } = makeStore();
    const orch = createReminderOrchestrator({
      mobile: false,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: () => {},
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    holder.orch = orch;
    orch.setReady(true);
    // Erster Aufbau lädt die Kandidaten (noch ohne Race).
    await orch.refreshSnapshot();
    expect(markFiredCalls).toBe(0);

    // Zweiter Aufbau: die Race in listFiredReminders feuert den Kandidaten,
    // BEVOR firedKeys zugewiesen wird.
    await orch.refreshSnapshot();
    await flush();
    expect(markFiredCalls).toBe(1);
    expect(notifyNowCalls).toHaveLength(1);

    // Nächster Tick darf NICHT erneut feuern (Merge hat den Key erhalten).
    orch.tick();
    await flush();
    expect(markFiredCalls).toBe(1);
    expect(notifyNowCalls).toHaveLength(1);
  });

  it("dismissMissed leert das Banner (onMissedChange([])) und markiert alle Verpassten als gefeuert", async () => {
    const nowBox = makeNow(NOW);
    const missedCandidate = appt({
      id: "missed",
      startTime: "08:00",
      endTime: "08:30",
    });
    const { db, markFiredCalls } = makeDb({ items: [missedCandidate] });
    const { notifications } = makeNotifications();
    const { store } = makeStore();
    const missedChanges: ReminderCandidate[][] = [];
    const orch = createReminderOrchestrator({
      mobile: false,
      db,
      notifications,
      scheduledStore: store,
      onMissedChange: (m) => missedChanges.push(m),
      requestSnapshotRefresh: () => {},
      now: nowBox.now,
    });
    orch.setReady(true);
    await orch.refreshSnapshot();
    expect(missedChanges[missedChanges.length - 1]).toHaveLength(1);

    orch.dismissMissed();
    expect(missedChanges[missedChanges.length - 1]).toEqual([]);
    expect(markFiredCalls.some((f) => f.appointmentId === "missed")).toBe(true);
  });
});
