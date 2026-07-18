import { describe, expect, it } from "vitest";
import type { AppointmentListItem } from "../types";
import {
  buildReminderCandidates,
  firedKey,
  reminderBody,
  selectDue,
  selectMissed,
  LIVE_WINDOW_MS,
} from "./reminderScheduler";

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
    reminders: [],
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

const ms = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number
): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe("buildReminderCandidates", () => {
  it("berechnet die Fälligkeit als Instanzbeginn minus Vorlauf", () => {
    const items = [
      appt({ reminders: [{ id: "r15", minutesBefore: 15 }] }),
    ];
    const cands = buildReminderCandidates(items, "2026-07-01", "2026-07-31");
    expect(cands).toHaveLength(1);
    expect(cands[0].dueMs).toBe(ms(2026, 7, 20, 9, 45));
    expect(cands[0].anchor).toBe("2026-07-20");
    expect(cands[0].appointmentId).toBe("a1");
    expect(cands[0].reminderId).toBe("r15");
  });

  it("nutzt für ganztägige Termine die 09:00-Basis", () => {
    const items = [
      appt({
        isAllDay: true,
        startTime: null,
        endTime: null,
        reminders: [{ id: "r0", minutesBefore: 0 }],
      }),
    ];
    const cands = buildReminderCandidates(items, "2026-07-01", "2026-07-31");
    expect(cands[0].dueMs).toBe(ms(2026, 7, 20, 9, 0));
    expect(cands[0].occStartTime).toBeNull();
  });

  it("expandiert Serien und lässt Overrides die Master-Erinnerungen erben", () => {
    const master = appt({
      id: "serie",
      rrule: "FREQ=WEEKLY;COUNT=2", // 20.07. + 27.07.
      reminders: [{ id: "r30", minutesBefore: 30 }],
    });
    const override = appt({
      id: "ov",
      parentId: "serie",
      recurrenceAnchor: "2026-07-27",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
      startTime: "14:00",
      endTime: "15:00",
      title: "Verschoben",
      reminders: [], // Override-Zeile trägt selbst keine
    });
    const cands = buildReminderCandidates(
      [master, override],
      "2026-07-01",
      "2026-07-31"
    );
    expect(cands).toHaveLength(2);
    // Verschobene Instanz feuert relativ zur NEUEN Zeit, Schlüssel bleibt am
    // Master (dessen Reminder-Zeile) + Original-Anker.
    const moved = cands.find((c) => c.anchor === "2026-07-27")!;
    expect(moved.dueMs).toBe(ms(2026, 7, 28, 13, 30));
    expect(moved.appointmentId).toBe("serie");
    expect(moved.reminderId).toBe("r30");
    expect(moved.title).toBe("Verschoben");
  });

  it("liefert nichts für Termine ohne Erinnerungen", () => {
    expect(
      buildReminderCandidates([appt()], "2026-07-01", "2026-07-31")
    ).toHaveLength(0);
  });
});

describe("selectDue / selectMissed", () => {
  const items = [
    appt({ reminders: [{ id: "r15", minutesBefore: 15 }] }), // fällig 09:45
  ];
  const cands = buildReminderCandidates(items, "2026-07-01", "2026-07-31");
  const due = ms(2026, 7, 20, 9, 45);

  it("liefert fällige Kandidaten im Live-Fenster und respektiert das Feuer-Protokoll", () => {
    expect(selectDue(cands, new Set(), due + 10_000)).toHaveLength(1);
    // Bereits gefeuert -> nicht erneut.
    const fired = new Set([firedKey(cands[0])]);
    expect(selectDue(cands, fired, due + 10_000)).toHaveLength(0);
    // Noch nicht fällig.
    expect(selectDue(cands, new Set(), due - 1_000)).toHaveLength(0);
    // Älter als das Live-Fenster -> nicht mehr "live" (sondern verpasst).
    expect(selectDue(cands, new Set(), due + LIVE_WINDOW_MS + 1)).toHaveLength(0);
  });

  it("stuft ältere unbehandelte Fälligkeiten als verpasst ein (mit Lookback-Grenze)", () => {
    const later = due + 2 * 60 * 60 * 1000; // 2 Std. später
    expect(selectMissed(cands, new Set(), later)).toHaveLength(1);
    const fired = new Set([firedKey(cands[0])]);
    expect(selectMissed(cands, fired, later)).toHaveLength(0);
    // Außerhalb des Nachhol-Fensters (8 Tage später bei 7 Tagen Lookback).
    const daysLater = due + 8 * 24 * 60 * 60 * 1000;
    expect(selectMissed(cands, new Set(), daysLater)).toHaveLength(0);
  });
});

describe("reminderBody", () => {
  it("formatiert heute/fremde Tage und ganztägig", () => {
    const timed = buildReminderCandidates(
      [appt({ reminders: [{ id: "r", minutesBefore: 0 }] })],
      "2026-07-01",
      "2026-07-31"
    )[0];
    expect(reminderBody(timed, "2026-07-20")).toBe("Heute 10:00 Uhr");
    expect(reminderBody(timed, "2026-07-19")).toBe("20.07.2026 10:00 Uhr");
    const allDay = buildReminderCandidates(
      [
        appt({
          isAllDay: true,
          startTime: null,
          endTime: null,
          reminders: [{ id: "r", minutesBefore: 0 }],
        }),
      ],
      "2026-07-01",
      "2026-07-31"
    )[0];
    expect(reminderBody(allDay, "2026-07-19")).toBe("20.07.2026 (ganztägig)");
  });
});
