import { describe, expect, it } from "vitest";
import type { AppointmentListItem } from "../types";
import {
  continuesFromPreviousDay,
  continuesToNextDay,
  expandOccurrences,
  formatOccurrenceTime,
  occurrencesOnDay,
  overlapsRange,
} from "./appointments";

function appt(overrides: Partial<AppointmentListItem> = {}): AppointmentListItem {
  return {
    id: "a1",
    title: "BR-Sitzung",
    location: "",
    description: "",
    isAllDay: false,
    startDate: "2026-07-20",
    startTime: "09:00",
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

describe("overlapsRange", () => {
  it("erkennt Überlappung inklusive der Randtage", () => {
    expect(overlapsRange("2026-07-01", "2026-07-01", "2026-07-01", "2026-07-31")).toBe(true);
    expect(overlapsRange("2026-06-28", "2026-07-01", "2026-07-01", "2026-07-31")).toBe(true);
    expect(overlapsRange("2026-07-31", "2026-08-02", "2026-07-01", "2026-07-31")).toBe(true);
    expect(overlapsRange("2026-06-01", "2026-06-30", "2026-07-01", "2026-07-31")).toBe(false);
    expect(overlapsRange("2026-08-01", "2026-08-01", "2026-07-01", "2026-07-31")).toBe(false);
  });
});

describe("expandOccurrences (Einzeltermine)", () => {
  it("liefert eine Instanz je überlappendem Einzeltermin, Anker = Startdatum", () => {
    const inWindow = appt({ id: "in" });
    const outside = appt({ id: "out", startDate: "2026-08-05", endDate: "2026-08-05" });
    const occs = expandOccurrences([inWindow, outside], "2026-07-01", "2026-07-31");
    expect(occs).toHaveLength(1);
    expect(occs[0].appointment.id).toBe("in");
    expect(occs[0].anchor).toBe("2026-07-20");
  });

  it("nimmt mehrtägige Termine auf, die nur mit einem Rand ins Fenster ragen", () => {
    const spanning = appt({
      id: "span",
      isAllDay: true,
      startTime: null,
      endTime: null,
      startDate: "2026-06-29",
      endDate: "2026-07-02",
    });
    const occs = expandOccurrences([spanning], "2026-07-01", "2026-07-31");
    expect(occs).toHaveLength(1);
    expect(occs[0].endDate).toBe("2026-07-02");
  });

  it("überspringt Overrides (gehören zu ihrer Serie, nicht zur Einzel-Expansion)", () => {
    const override = appt({
      id: "ov",
      parentId: "master",
      recurrenceAnchor: "2026-07-20",
    });
    expect(expandOccurrences([override], "2026-07-01", "2026-07-31")).toHaveLength(0);
  });
});

describe("occurrencesOnDay", () => {
  it("ordnet mehrtägige Instanzen jedem berührten Tag zu", () => {
    const occs = expandOccurrences(
      [
        appt({
          id: "span",
          isAllDay: true,
          startTime: null,
          endTime: null,
          startDate: "2026-07-20",
          endDate: "2026-07-22",
        }),
      ],
      "2026-07-01",
      "2026-07-31"
    );
    expect(occurrencesOnDay(occs, "2026-07-19")).toHaveLength(0);
    expect(occurrencesOnDay(occs, "2026-07-20")).toHaveLength(1);
    expect(occurrencesOnDay(occs, "2026-07-21")).toHaveLength(1);
    expect(occurrencesOnDay(occs, "2026-07-22")).toHaveLength(1);
    expect(occurrencesOnDay(occs, "2026-07-23")).toHaveLength(0);
  });
});

describe("sortOccurrences", () => {
  it("sortiert nach Datum, ganztägig zuerst, dann Startzeit, dann Titel", () => {
    const occs = expandOccurrences(
      [
        appt({ id: "b", title: "B-Termin", startTime: "14:00", endTime: "15:00" }),
        appt({ id: "a", title: "A-Termin", startTime: "14:00", endTime: "15:00" }),
        appt({
          id: "allday",
          isAllDay: true,
          startTime: null,
          endTime: null,
        }),
        appt({ id: "früh", startTime: "08:00", endTime: "09:00" }),
        appt({ id: "vortag", startDate: "2026-07-19", endDate: "2026-07-19" }),
      ],
      "2026-07-01",
      "2026-07-31"
    );
    expect(occs.map((o) => o.appointment.id)).toEqual([
      "vortag",
      "allday",
      "früh",
      "a",
      "b",
    ]);
  });
});

describe("Anzeige-Helfer", () => {
  it("formatiert Zeitspanne bzw. Ganztägig", () => {
    const timed = expandOccurrences([appt()], "2026-07-01", "2026-07-31")[0];
    expect(formatOccurrenceTime(timed)).toBe("09:00–11:00");
    const allDay = expandOccurrences(
      [appt({ isAllDay: true, startTime: null, endTime: null })],
      "2026-07-01",
      "2026-07-31"
    )[0];
    expect(formatOccurrenceTime(allDay)).toBe("Ganztägig");
  });

  it("kennzeichnet Fortsetzungstage mehrtägiger Instanzen", () => {
    const occ = expandOccurrences(
      [
        appt({
          isAllDay: true,
          startTime: null,
          endTime: null,
          startDate: "2026-07-20",
          endDate: "2026-07-22",
        }),
      ],
      "2026-07-01",
      "2026-07-31"
    )[0];
    expect(continuesFromPreviousDay(occ, "2026-07-20")).toBe(false);
    expect(continuesFromPreviousDay(occ, "2026-07-21")).toBe(true);
    expect(continuesToNextDay(occ, "2026-07-21")).toBe(true);
    expect(continuesToNextDay(occ, "2026-07-22")).toBe(false);
  });
});
