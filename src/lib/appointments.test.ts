import { describe, expect, it } from "vitest";
import type { AppointmentListItem } from "../types";
import {
  buildRrule,
  continuesFromPreviousDay,
  continuesToNextDay,
  expandOccurrences,
  formatOccurrenceTime,
  occurrencesOnDay,
  overlapsRange,
  parseRruleToPreset,
  remainingCountFrom,
  rruleWithUntil,
  splitUntilDate,
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

describe("expandOccurrences (Serien)", () => {
  it("expandiert eine zweiwöchentliche BYDAY-Serie korrekt ins Fenster", () => {
    // Start Mi, 2026-07-01; alle 2 Wochen Mo+Mi.
    const master = appt({
      id: "serie",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
    });
    const occs = expandOccurrences([master], "2026-07-01", "2026-08-11");
    expect(occs.map((o) => o.anchor)).toEqual([
      "2026-07-01", // Mi (DTSTART)
      "2026-07-13", // Mo
      "2026-07-15", // Mi
      "2026-07-27", // Mo
      "2026-07-29", // Mi
      "2026-08-10", // Mo
    ]);
    // Generierte Instanzen tragen die Master-Zeiten.
    expect(occs[1].startTime).toBe("09:00");
    expect(occs[1].endDate).toBe("2026-07-13");
  });

  it("respektiert COUNT und UNTIL", () => {
    const countSerie = appt({
      id: "count",
      rrule: "FREQ=DAILY;COUNT=3",
    });
    expect(
      expandOccurrences([countSerie], "2026-07-01", "2026-08-31").map((o) => o.anchor)
    ).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);

    const untilSerie = appt({
      id: "until",
      rrule: "FREQ=DAILY;UNTIL=20260722",
    });
    expect(
      expandOccurrences([untilSerie], "2026-07-01", "2026-08-31").map((o) => o.anchor)
    ).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });

  it("filtert Exdates heraus", () => {
    const master = appt({
      id: "serie",
      rrule: "FREQ=DAILY;COUNT=4",
      exdates: ["2026-07-21", "2026-07-23"],
    });
    expect(
      expandOccurrences([master], "2026-07-01", "2026-08-31").map((o) => o.anchor)
    ).toEqual(["2026-07-20", "2026-07-22"]);
  });

  it("ersetzt Instanzen durch ihre Overrides -- auch bei Verschiebung in einen anderen Monat", () => {
    const master = appt({
      id: "serie",
      rrule: "FREQ=WEEKLY;COUNT=3", // 20.07., 27.07., 03.08.
    });
    const override = appt({
      id: "ov",
      parentId: "serie",
      recurrenceAnchor: "2026-07-27",
      startDate: "2026-08-15", // in den Folgemonat verschoben
      endDate: "2026-08-15",
      startTime: "14:00",
      endTime: "15:00",
      title: "Verschoben",
    });

    // Juli-Fenster: die verschobene Instanz erscheint NICHT mehr am 27.07.
    const juli = expandOccurrences([master, override], "2026-07-01", "2026-07-31");
    expect(juli.map((o) => o.anchor)).toEqual(["2026-07-20"]);

    // August-Fenster: Override erscheint am neuen Datum, Anker bleibt der 27.07.
    const august = expandOccurrences([master, override], "2026-08-01", "2026-08-31");
    expect(august.map((o) => `${o.appointment.id}@${o.startDate}`)).toEqual([
      "serie@2026-08-03",
      "ov@2026-08-15",
    ]);
    expect(august[1].anchor).toBe("2026-07-27");
  });

  it("vereinfacht Regeln mit mehreren Instanzen pro Tag auf die erste (Anker-Granularität)", () => {
    const master = appt({ id: "hourly", rrule: "FREQ=HOURLY;COUNT=30" });
    const occs = expandOccurrences([master], "2026-07-01", "2026-08-31");
    // 30 Stunden ab 20.07. 09:00 -> zwei Kalendertage, je EINE Instanz.
    expect(occs.map((o) => o.anchor)).toEqual(["2026-07-20", "2026-07-21"]);
  });

  it("terminiert bei entarteten Regeln über den Iterations-Guard", () => {
    const master = appt({ id: "minutely", rrule: "FREQ=MINUTELY" }); // endlos, 1440/Tag
    const occs = expandOccurrences([master], "2026-07-01", "2027-07-01");
    // Guard greift nach 10 000 Iterationen (~7 Tage a 1440 Minuten).
    expect(occs.length).toBeGreaterThan(0);
    expect(occs.length).toBeLessThan(20);
  });

  it("zeigt bei nicht parsebarer Regel defensiv den Start-Termin", () => {
    const master = appt({ id: "kaputt", rrule: "KEIN=RRULE" });
    const occs = expandOccurrences([master], "2026-07-01", "2026-07-31");
    expect(occs).toHaveLength(1);
    expect(occs[0].anchor).toBe("2026-07-20");
  });
});

describe("Serienregel-Presets", () => {
  it("buildRrule/parseRruleToPreset sind zueinander invers", () => {
    const preset = {
      freq: "WEEKLY" as const,
      interval: 2,
      byWeekdays: ["MO", "WE"] as ("MO" | "WE")[],
      end: { type: "count" as const, count: 10 },
    };
    const rrule = buildRrule(preset);
    expect(rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
    expect(parseRruleToPreset(rrule)).toEqual(preset);

    expect(parseRruleToPreset("FREQ=DAILY")).toEqual({
      freq: "DAILY",
      interval: 1,
      byWeekdays: [],
      end: { type: "never" },
    });
    expect(parseRruleToPreset("FREQ=YEARLY;UNTIL=20301231")).toEqual({
      freq: "YEARLY",
      interval: 1,
      byWeekdays: [],
      end: { type: "until", date: "2030-12-31" },
    });
  });

  it("liefert null für Regeln außerhalb der Preset-Teilmenge (bleiben benutzerdefiniert)", () => {
    expect(parseRruleToPreset("FREQ=MONTHLY;BYDAY=2MO")).toBeNull(); // Ordinal
    expect(parseRruleToPreset("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO")).toBeNull();
    expect(parseRruleToPreset("FREQ=DAILY;COUNT=3;UNTIL=20261231")).toBeNull(); // RFC-widrig
    expect(parseRruleToPreset("FREQ=SECONDLY")).toBeNull();
  });

  it("rruleWithUntil ersetzt COUNT durch UNTIL und splitUntilDate liefert den Vortag", () => {
    expect(rruleWithUntil("FREQ=WEEKLY;INTERVAL=2;COUNT=10", "2026-07-26")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;UNTIL=20260726"
    );
    expect(splitUntilDate("2026-07-27")).toBe("2026-07-26");
    expect(splitUntilDate("2026-08-01")).toBe("2026-07-31");
  });

  it("remainingCountFrom zieht die vor dem Anker verbrauchten Instanzen ab", () => {
    const master = appt({
      id: "serie",
      rrule: "FREQ=WEEKLY;COUNT=10", // ab 20.07. wöchentlich
    });
    // Anker = 4. Instanz (10.08.): 3 Instanzen davor -> 7 verbleiben.
    expect(remainingCountFrom(master, "2026-08-10")).toBe(7);
    // Regel ohne COUNT -> null.
    expect(remainingCountFrom(appt({ rrule: "FREQ=WEEKLY" }), "2026-08-10")).toBeNull();
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
