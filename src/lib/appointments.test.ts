import { describe, expect, it } from "vitest";
import type { AppointmentFullItem, AppointmentListItem } from "../types";
import {
  buildOverrideDraft,
  buildRrule,
  buildSplitDraft,
  continuesFromPreviousDay,
  continuesToNextDay,
  duplicateAppointment,
  expandOccurrences,
  formatOccurrenceTime,
  occurrencesOnDay,
  overlapsRange,
  parseRruleToPreset,
  plainAppointment,
  remainingCountFrom,
  resolveOverride,
  rruleWithCount,
  rruleWithUntil,
  seriesEndDateFor,
  splitUntilDate,
  truncatedMaster,
  type SeriesEndInput,
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

  it("zeigt Overrides eines Masters ohne RRULE weiterhin an", () => {
    // Entsteht real: Serie mit bearbeiteten Instanzen wird auf "Nie" gestellt,
    // oder ICS-Import einer RDATE-Serie (RRULE verworfen) mit RECURRENCE-IDs.
    const master = appt({ id: "master", rrule: null });
    const override = appt({
      id: "ov",
      parentId: "master",
      recurrenceAnchor: "2026-07-27",
      startDate: "2026-07-25",
      endDate: "2026-07-25",
    });
    const occs = expandOccurrences([master, override], "2026-07-01", "2026-07-31");
    expect(occs.map((o) => o.appointment.id).sort()).toEqual(["master", "ov"]);
  });

  it("lässt einen Override am Master-Anker die Master-Instanz ersetzen (rrule=null)", () => {
    const master = appt({ id: "master", rrule: null });
    const override = appt({
      id: "ov",
      parentId: "master",
      recurrenceAnchor: "2026-07-20", // == master.startDate
      startDate: "2026-07-21",
      endDate: "2026-07-21",
    });
    const occs = expandOccurrences([master, override], "2026-07-01", "2026-07-31");
    expect(occs.map((o) => o.appointment.id)).toEqual(["ov"]);
  });

  it("vereinfacht Regeln mit mehreren Instanzen pro Tag auf die erste (Anker-Granularität)", () => {
    const master = appt({ id: "hourly", rrule: "FREQ=HOURLY;COUNT=30" });
    const occs = expandOccurrences([master], "2026-07-01", "2026-08-31");
    // 30 Stunden ab 20.07. 09:00 -> zwei Kalendertage, je EINE Instanz.
    expect(occs.map((o) => o.anchor)).toEqual(["2026-07-20", "2026-07-21"]);
  });

  it("expandiert hochfrequente Serien auch in weit entfernten Fenstern (kein stiller Abbruch)", () => {
    // FREQ=HOURLY braucht ~17 800 Iterationen bis Juli 2028 -- das alte Limit
    // von 10 000 ließ die Serie dort stillschweigend verschwinden.
    const master = appt({ id: "hourly", rrule: "FREQ=HOURLY" });
    const occs = expandOccurrences([master], "2028-07-01", "2028-07-31");
    expect(occs.length).toBe(31);
  });

  it("terminiert bei entarteten Regeln über den Iterations-Guard", () => {
    const master = appt({ id: "minutely", rrule: "FREQ=MINUTELY" }); // endlos, 1440/Tag
    const occs = expandOccurrences([master], "2026-07-01", "2027-07-01");
    // Guard begrenzt die Expansion (100 000 Iterationen ≈ 70 Tage a 1440 Minuten),
    // statt das ganze Jahr zu füllen -- wichtig ist: er terminiert.
    expect(occs.length).toBeGreaterThan(0);
    expect(occs.length).toBeLessThan(100);
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

  it("rechnet UTC-UNTIL in lokale Wandzeit um statt das Datum abzuschneiden", () => {
    // 20260630T223000Z liegt lokal (z. B. Europe/Berlin im Sommer) bereits am
    // Folgetag -- reines Abschneiden auf die ersten 8 Ziffern würde die Serie
    // beim Re-Save über das Formular einen Tag zu früh kappen. Erwartung
    // TZ-unabhängig über die lokalen Date-Getter abgeleitet.
    const js = new Date(Date.UTC(2026, 5, 30, 22, 30));
    const p = (n: number) => String(n).padStart(2, "0");
    const expected = `${js.getFullYear()}-${p(js.getMonth() + 1)}-${p(js.getDate())}`;
    expect(parseRruleToPreset("FREQ=DAILY;UNTIL=20260630T223000Z")).toEqual({
      freq: "DAILY",
      interval: 1,
      byWeekdays: [],
      end: { type: "until", date: expected },
    });
    // Floating UNTIL (ohne Z) bleibt beim wörtlichen Datum.
    expect(parseRruleToPreset("FREQ=DAILY;UNTIL=20260630T235959")).toEqual({
      freq: "DAILY",
      interval: 1,
      byWeekdays: [],
      end: { type: "until", date: "2026-06-30" },
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

describe("seriesEndDateFor", () => {
  function master(overrides: Partial<SeriesEndInput> = {}): SeriesEndInput {
    return {
      rrule: null,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      startTime: "09:00",
      isAllDay: false,
      ...overrides,
    };
  }

  it("liefert null ohne RRULE (Einzeltermin)", () => {
    expect(seriesEndDateFor(master({ rrule: null }))).toBeNull();
  });

  it("liefert null bei endloser Serie (weder COUNT noch UNTIL)", () => {
    expect(seriesEndDateFor(master({ rrule: "FREQ=DAILY" }))).toBeNull();
  });

  it("übernimmt ein Datums-UNTIL direkt als Serienende", () => {
    expect(
      seriesEndDateFor(master({ rrule: "FREQ=DAILY;UNTIL=20260731" }))
    ).toBe("2026-07-31");
  });

  it("ermittelt das Serienende bei COUNT über Iteration ab DTSTART", () => {
    expect(seriesEndDateFor(master({ rrule: "FREQ=WEEKLY;COUNT=3" }))).toBe(
      "2026-07-15"
    );
  });

  it("addiert die Terminspanne bei mehrtägigen COUNT-Serien auf den letzten Anker", () => {
    expect(
      seriesEndDateFor(
        master({ endDate: "2026-07-03", rrule: "FREQ=WEEKLY;COUNT=2" })
      )
    ).toBe("2026-07-10");
  });

  it("rechnet ein Zeit-UNTIL in UTC in lokale Wandzeit um (Berlin-TZ)", () => {
    expect(
      seriesEndDateFor(master({ rrule: "FREQ=DAILY;UNTIL=20260101T060000Z" }))
    ).toBe("2026-01-01");
  });

  it("liefert null bei kaputter Regel (ICAL.Recur.fromString wirft)", () => {
    expect(seriesEndDateFor(master({ rrule: "FREQ=KAPUTT" }))).toBeNull();
  });

  it("addiert die Terminspanne bei mehrtägigen UNTIL-Serien auf das UNTIL-Datum", () => {
    expect(
      seriesEndDateFor(
        master({ endDate: "2026-07-02", rrule: "FREQ=WEEKLY;UNTIL=20260715" })
      )
    ).toBe("2026-07-16");
  });

  it("liefert das Startdatum als Serienende bei COUNT=1", () => {
    expect(seriesEndDateFor(master({ rrule: "FREQ=DAILY;COUNT=1" }))).toBe(
      "2026-07-01"
    );
  });

  // Anker = max(UTC-Datum, lokales Datum) des UNTIL (s. Doc-Kommentar an
  // seriesEndDateFor): östlich von UTC (Testumgebung: Europa/Berlin) ist das
  // lokale Datum stets >= dem UTC-Datum, der West-Fall (lokal < UTC) lässt
  // sich hier daher nicht erzeugen (process.env.TZ ist zur Laufzeit auf
  // Windows/Node nicht verlässlich umschaltbar). Die beiden folgenden Tests
  // decken die in dieser TZ erreichbaren Seiten der max()-Bildung ab: einmal
  // "lokal == UTC", einmal "lokal > UTC".
  it("verwendet das UTC-Datum, wenn UTC- und lokales Datum des UNTIL übereinstimmen", () => {
    expect(
      seriesEndDateFor(master({ rrule: "FREQ=DAILY;UNTIL=20260101T060000Z" }))
    ).toBe("2026-01-01");
  });

  it("verwendet das lokale (spätere) Datum, wenn ein Zeit-UNTIL lokal auf den Folgetag des UTC-Datums fällt", () => {
    // UNTIL=20260101T230000Z: UTC-Datum 2026-01-01, lokal (Berlin, Winterzeit
    // UTC+1) 2026-01-02 00:00 -> lokales Datum 2026-01-02, das SPÄTERE der
    // beiden -- genau das liefert schon das reine `localIsoFromJsDate` ohne
    // max()-Bildung (Berlin ist östlich von UTC). Dieser Test ist daher eine
    // Regressionssicherung für die erreichbare Seite, kein RED-Beweis für die
    // max()-Bildung selbst (die schützt nur den hier nicht erzeugbaren
    // West-Fall, s. Kommentar oben).
    expect(
      seriesEndDateFor(master({ rrule: "FREQ=DAILY;UNTIL=20260101T230000Z" }))
    ).toBe("2026-01-02");
  });

  it("bleibt bei einer RFC-widrigen Regel mit COUNT UND UNTIL konservativ (nimmt den UNTIL-Zweig als Obergrenze)", () => {
    // RFC 5545 verbietet COUNT und UNTIL gemeinsam; ICAL.Recur.fromString
    // akzeptiert die Kombination trotzdem (parseRruleToPreset lehnt sie zwar
    // ab, seriesEndDateFor arbeitet aber direkt auf ICAL.Recur). Da
    // `if (recur.until)` vor der COUNT-Prüfung greift, gewinnt hier IMMER der
    // UNTIL-Zweig -- das bleibt konservativ, weil der ical.js-Iterator
    // (recur_iterator.js: `this.last.compare(this.rule.until) > 0`) so oder
    // so NIE eine Instanz nach UNTIL emittiert, unabhängig davon, ob COUNT
    // oder UNTIL zuerst greift: die tatsächlich letzte Instanz liegt immer
    // <= UNTIL, das UNTIL-Datum ist also immer eine gültige (ggf. zu späte,
    // nie zu frühe) Obergrenze.
    expect(
      seriesEndDateFor(
        master({ rrule: "FREQ=DAILY;COUNT=1000;UNTIL=20260705" })
      )
    ).toBe("2026-07-05");
  });

  it("klemmt eine negative Terminspanne (endDate < startDate) auch im COUNT-Zweig auf 0", () => {
    // Nur über handeditierte/korrupte Daten erreichbar (DB-CHECK und
    // ICS-Import verhindern endDate < startDate) -- der Clamp muss trotzdem
    // zentral (für UNTIL UND COUNT) greifen, sonst läge das Serienende VOR
    // der letzten Instanz (Konservativitäts-Verletzung). Instanzen ab
    // 2026-07-01 (Mi) wöchentlich, COUNT=3 -> letzter Anker 2026-07-15;
    // ohne zentralen Clamp würde spanDays=-1 das Ergebnis auf 2026-07-14 ziehen.
    expect(
      seriesEndDateFor(
        master({
          startDate: "2026-07-01",
          endDate: "2026-06-30",
          rrule: "FREQ=WEEKLY;COUNT=3",
        })
      )
    ).toBe("2026-07-15");
  });
});

describe("Termin-Builder (Serien-Scope-Operationen)", () => {
  function fullAppt(
    overrides: Partial<AppointmentFullItem> = {}
  ): AppointmentFullItem {
    return { ...appt(), secretDetails: "", ...overrides };
  }
  const master = () =>
    fullAppt({
      id: "serie",
      rrule: "FREQ=WEEKLY;COUNT=10", // Instanzen ab 20.07. wöchentlich
      exdates: ["2026-07-27", "2026-08-17"],
      tagIds: ["tag-1"],
      tagLabels: ["BR"],
      reminders: [{ id: "rem-old", minutesBefore: 30 }],
      icsUid: "x@example.org",
      icsSequence: 3,
    });
  const occ = {
    anchor: "2026-08-10",
    startDate: "2026-08-10",
    startTime: "09:00",
    endDate: "2026-08-10",
    endTime: "11:00",
  };

  it("plainAppointment entfernt genau das Anzeige-Feld tagLabels", () => {
    const plain = plainAppointment(master());
    expect("tagLabels" in plain).toBe(false);
    expect(plain.id).toBe("serie");
    expect(plain.secretDetails).toBe("");
    expect(plain.reminders).toEqual([{ id: "rem-old", minutesBefore: 30 }]);
  });

  it("buildOverrideDraft koppelt die Ausnahme an Master+Anker ohne eigene Erbfelder", () => {
    const d = buildOverrideDraft(master(), occ);
    expect(d.parentId).toBe("serie");
    expect(d.recurrenceAnchor).toBe("2026-08-10");
    expect(d.startDate).toBe("2026-08-10");
    expect(d.rrule).toBeNull();
    expect(d.exdates).toEqual([]);
    expect(d.tagIds).toEqual([]); // erben vom Master, eigene Zeile trägt keine
    expect(d.reminders).toEqual([]);
    expect(d.icsUid).toBeNull();
    expect(d.id).not.toBe("serie");
  });

  it("buildSplitDraft übernimmt Rest-COUNT, spätere Exdates und NEUE Erinnerungs-IDs", () => {
    const d = buildSplitDraft(master(), occ);
    expect(d.startDate).toBe("2026-08-10");
    // 3 Instanzen vor dem Anker (20.07., 27.07. als Exdate zählt mit, 03.08.).
    expect(d.rrule).toBe("FREQ=WEEKLY;COUNT=7");
    expect(d.exdates).toEqual(["2026-08-17"]);
    expect(d.reminders).toHaveLength(1);
    expect(d.reminders[0].minutesBefore).toBe(30);
    expect(d.reminders[0].id).not.toBe("rem-old"); // PK global eindeutig
    expect(d.icsUid).toBeNull();
    expect(d.icsSequence).toBe(0);
    expect(d.id).not.toBe("serie");
  });

  it("truncatedMaster kappt per UNTIL am Vortag und behält nur frühere Exdates", () => {
    const t = truncatedMaster(master(), "2026-08-10");
    expect(t.rrule).toBe("FREQ=WEEKLY;UNTIL=20260809");
    expect(t.exdates).toEqual(["2026-07-27"]);
    expect(t.id).toBe("serie"); // dieselbe Zeile, kein Neuanlegen
  });

  it("duplicateAppointment verschiebt auf heute, erhält die Dauer und erneuert Identitäten", () => {
    const src = fullAppt({
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      reminders: [{ id: "rem-old", minutesBefore: 15 }],
      icsUid: "x@example.org",
      icsSequence: 2,
      rrule: "FREQ=WEEKLY",
      exdates: ["2026-07-27"],
    });
    const d = duplicateAppointment(src, "2026-09-01");
    expect(d.id).not.toBe(src.id);
    expect(d.startDate).toBe("2026-09-01");
    expect(d.endDate).toBe("2026-09-03"); // Dauer in Tagen erhalten
    expect(d.rrule).toBeNull();
    expect(d.exdates).toEqual([]);
    expect(d.icsUid).toBeNull();
    expect(d.icsSequence).toBe(0);
    expect(d.tagIds).toEqual(src.tagIds);
    expect(d.reminders[0].minutesBefore).toBe(15);
    expect(d.reminders[0].id).not.toBe("rem-old");
  });

  it("rruleWithCount ersetzt das Kontingent segmentbasiert", () => {
    expect(rruleWithCount("FREQ=WEEKLY;INTERVAL=2;COUNT=10", 7)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;COUNT=7"
    );
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

describe("resolveOverride", () => {
  it("übernimmt tagIds/reminders/tagLabels vom Master, übrige Felder vom Override -- als neues Objekt", () => {
    const master = appt({
      id: "master",
      tagIds: ["tag-1"],
      tagLabels: ["BR"],
      reminders: [{ id: "rem-1", minutesBefore: 30 }],
    });
    const override = appt({
      id: "ov",
      parentId: "master",
      recurrenceAnchor: "2026-07-20",
      startDate: "2026-07-21",
      tagIds: [],
      tagLabels: [],
      reminders: [],
    });
    const masterSnapshot = structuredClone(master);
    const overrideSnapshot = structuredClone(override);
    const resolved = resolveOverride(override, master);
    expect(resolved).not.toBe(override); // neues Objekt, kein Mutieren
    expect(resolved.tagIds).toEqual(["tag-1"]);
    expect(resolved.tagLabels).toEqual(["BR"]);
    expect(resolved.reminders).toEqual([{ id: "rem-1", minutesBefore: 30 }]);
    // Übrige Felder bleiben die des Override.
    expect(resolved.id).toBe("ov");
    expect(resolved.startDate).toBe("2026-07-21");
    expect(resolved.recurrenceAnchor).toBe("2026-07-20");
    // Inputs (override, master) bleiben unmutiert.
    expect(override).toEqual(overrideSnapshot);
    expect(master).toEqual(masterSnapshot);
  });

  it("lässt einen Nicht-Override (parentId === null) unverändert", () => {
    const single = appt({
      id: "a1",
      tagIds: ["x"],
      reminders: [{ id: "r", minutesBefore: 5 }],
    });
    const other = appt({ id: "other", tagIds: ["y"] });
    expect(resolveOverride(single, other)).toBe(single);
  });

  it("lässt einen Override ohne (geladenen) Master unverändert", () => {
    const override = appt({
      id: "ov",
      parentId: "master",
      tagIds: ["own"],
      reminders: [],
    });
    expect(resolveOverride(override, null)).toBe(override);
    expect(resolveOverride(override, undefined)).toBe(override);
  });
});
