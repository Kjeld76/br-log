import { describe, expect, it } from "vitest";
import type { AppointmentFullItem } from "../types";
import { buildIcs, parseIcs, planIcsImport } from "./ics";

function appt(
  overrides: Partial<AppointmentFullItem> = {}
): AppointmentFullItem {
  return {
    id: "a1",
    title: "BR-Sitzung",
    location: "Raum 1",
    description: "Tagesordnung",
    secretDetails: "",
    isAllDay: false,
    startDate: "2026-07-20",
    startTime: "10:00",
    endDate: "2026-07-20",
    endTime: "11:30",
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
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("buildIcs/parseIcs Roundtrip", () => {
  it("zeitgebundener Einzeltermin bleibt über den Roundtrip identisch (floating)", () => {
    const text = buildIcs([appt({ isImportant: true })], {
      includeConfidential: false,
    });
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("DTSTART:20260720T100000");
    expect(text).toContain("PRIORITY:1");

    const { items, warnings } = parseIcs(text);
    expect(warnings).toEqual([]);
    expect(items).toHaveLength(1);
    const a = items[0].appointment;
    expect(a.title).toBe("BR-Sitzung");
    expect(a.location).toBe("Raum 1");
    expect(a.isAllDay).toBe(false);
    expect(a.startDate).toBe("2026-07-20");
    expect(a.startTime).toBe("10:00");
    expect(a.endDate).toBe("2026-07-20");
    expect(a.endTime).toBe("11:30");
    expect(a.isImportant).toBe(true);
    expect(a.icsUid).toBe("a1@br-log.local");
  });

  it("mehrtägig-ganztägig: DTEND exklusiv beim Export, inklusiv nach dem Import", () => {
    const text = buildIcs(
      [
        appt({
          isAllDay: true,
          startTime: null,
          endTime: null,
          startDate: "2026-07-21",
          endDate: "2026-07-23",
        }),
      ],
      { includeConfidential: false }
    );
    // Export: letzter Tag (23.) + 1 = 24. (exklusiv), VALUE=DATE.
    expect(text).toContain("DTSTART;VALUE=DATE:20260721");
    expect(text).toContain("DTEND;VALUE=DATE:20260724");

    const a = parseIcs(text).items[0].appointment;
    expect(a.isAllDay).toBe(true);
    expect(a.startDate).toBe("2026-07-21");
    expect(a.endDate).toBe("2026-07-23"); // wieder inklusiv
    expect(a.startTime).toBeNull();
  });

  it("Serie mit Exdates + Override (RECURRENCE-ID) übersteht den Roundtrip", () => {
    const master = appt({
      id: "serie",
      rrule: "FREQ=WEEKLY;COUNT=5",
      exdates: ["2026-08-03"],
      reminders: [{ id: "r30", minutesBefore: 30 }],
    });
    const override = appt({
      id: "ov",
      title: "Verschoben",
      parentId: "serie",
      recurrenceAnchor: "2026-07-27",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
      startTime: "14:00",
      endTime: "15:00",
    });
    const text = buildIcs([master, override], { includeConfidential: false });
    expect(text).toContain("RRULE:FREQ=WEEKLY;COUNT=5");
    expect(text).toContain("EXDATE:20260803T100000");
    expect(text).toContain("RECURRENCE-ID:20260727T100000");
    expect(text).toContain("TRIGGER:-PT30M");

    const { items } = parseIcs(text);
    expect(items).toHaveLength(2);
    const m = items.find((i) => i.appointment.parentId === null)!.appointment;
    const o = items.find((i) => i.appointment.parentId !== null)!.appointment;
    expect(m.rrule).toBe("FREQ=WEEKLY;COUNT=5");
    expect(m.exdates).toEqual(["2026-08-03"]);
    expect(m.reminders.map((r) => r.minutesBefore)).toEqual([30]);
    expect(o.parentId).toBe(m.id);
    expect(o.recurrenceAnchor).toBe("2026-07-27");
    expect(o.startDate).toBe("2026-07-28");
    expect(o.reminders).toEqual([]); // erben vom Master
  });

  it("hebt Datums-UNTIL bei zeitgebundenen Serien im Export auf Tagesende an", () => {
    const text = buildIcs(
      [appt({ rrule: "FREQ=DAILY;UNTIL=20260731" })],
      { includeConfidential: false }
    );
    expect(text).toContain("UNTIL=20260731T235959");
  });

  it("exportiert vertrauliche Notizen NUR mit includeConfidential", () => {
    const items = [appt({ secretDetails: "Geheim" })];
    expect(buildIcs(items, { includeConfidential: false })).not.toContain("Geheim");
    const withSecret = buildIcs(items, { includeConfidential: true });
    expect(withSecret).toContain("X-BRLOG-SECRET:Geheim");
    expect(parseIcs(withSecret).items[0].appointment.secretDetails).toBe("Geheim");
  });

  it("exportiert Schlagwörter als CATEGORIES und liest sie zurück", () => {
    const text = buildIcs(
      [appt({ tagLabels: ["BR-Sitzung", "Fahrzeit"] })],
      { includeConfidential: false }
    );
    expect(text).toContain("CATEGORIES:BR-Sitzung,Fahrzeit");
    expect(parseIcs(text).items[0].categories).toEqual(["BR-Sitzung", "Fahrzeit"]);
  });
});

describe("parseIcs Fremddateien", () => {
  it("rechnet TZID-Zeiten über die VTIMEZONE in lokale Wandzeit um", () => {
    // 20.07.2026 10:00 Europe/Berlin (Sommerzeit) = 08:00 UTC.
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "TZNAME:CEST",
      "DTSTART:19700329T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "TZNAME:CET",
      "DTSTART:19701025T030000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:tz-test@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART;TZID=Europe/Berlin:20260720T100000",
      "DTEND;TZID=Europe/Berlin:20260720T113000",
      "SUMMARY:TZ-Termin",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const a = parseIcs(text).items[0].appointment;
    // Unabhängige Ableitung der erwarteten LOKALEN Wandzeit über UTC.
    const utc = new Date(Date.UTC(2026, 6, 20, 8, 0));
    const p = (n: number) => String(n).padStart(2, "0");
    expect(a.startDate).toBe(
      `${utc.getFullYear()}-${p(utc.getMonth() + 1)}-${p(utc.getDate())}`
    );
    expect(a.startTime).toBe(`${p(utc.getHours())}:${p(utc.getMinutes())}`);
  });

  it("liest SEQUENCE und überspringt VEVENTs ohne DTSTART mit Hinweis", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:seq@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T100000",
      "DTEND:20260720T110000",
      "SEQUENCE:4",
      "SUMMARY:Aktualisiert",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:kaputt@example.org",
      "DTSTAMP:20260701T000000Z",
      "SUMMARY:Ohne Start",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { items, warnings } = parseIcs(text);
    expect(items).toHaveLength(1);
    expect(items[0].appointment.icsSequence).toBe(4);
    expect(warnings.some((w) => w.includes("ohne Startzeitpunkt"))).toBe(true);
  });

  it("meldet RDATE und absolute VALARM-Trigger als Hinweise, importiert den Termin aber", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:rdate@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T100000",
      "DTEND:20260720T110000",
      "RRULE:FREQ=WEEKLY",
      "RDATE:20260722T100000",
      "SUMMARY:Mit RDATE",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER;VALUE=DATE-TIME:20260720T090000Z",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { items, warnings } = parseIcs(text);
    expect(items).toHaveLength(1);
    expect(items[0].appointment.rrule).toBe("FREQ=WEEKLY");
    expect(warnings.some((w) => w.includes("RDATE"))).toBe(true);
    expect(warnings.some((w) => w.includes("absolutem Zeitpunkt"))).toBe(true);
  });

  it("übernimmt eine Serien-Ausnahme ohne Master als Einzeltermin", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:orphan@example.org",
      "DTSTAMP:20260701T000000Z",
      "RECURRENCE-ID:20260720T100000",
      "DTSTART:20260721T100000",
      "DTEND:20260721T110000",
      "SUMMARY:Waise",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { items, warnings } = parseIcs(text);
    expect(items).toHaveLength(1);
    expect(items[0].appointment.parentId).toBeNull();
    expect(items[0].appointment.icsUid).toBeNull();
    expect(warnings.some((w) => w.includes("ohne zugehörige Serie"))).toBe(true);
  });

  it("wirft bei unlesbarem Inhalt eine verständliche Meldung", () => {
    expect(() => parseIcs("kein ics")).toThrow("iCalendar");
    expect(() =>
      parseIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR")
    ).toThrow("keine importierbaren Termine");
  });

  it("erhält den Ganztägig-Status einer Serien-Ausnahme (keine erfundenen Uhrzeiten)", () => {
    // Fremdkalender: zeitgebundene Serie, eine Instanz wurde auf ganztägig
    // geändert. Der DB-CHECK ist zeilenweise -- gemischte Zustände zwischen
    // Master und Override sind erlaubt; 09:00-10:00 zu erfinden ist falsch.
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:mix@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T100000",
      "DTEND:20260720T113000",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Zeitgebunden",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:mix@example.org",
      "DTSTAMP:20260701T000000Z",
      "RECURRENCE-ID:20260727T100000",
      "DTSTART;VALUE=DATE:20260727",
      "DTEND;VALUE=DATE:20260728",
      "SUMMARY:Jetzt ganztägig",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { items } = parseIcs(text);
    const ov = items.find((i) => i.appointment.parentId !== null)!.appointment;
    expect(ov.isAllDay).toBe(true);
    expect(ov.startTime).toBeNull();
    expect(ov.endTime).toBeNull();
    expect(ov.startDate).toBe("2026-07-27");
    expect(ov.endDate).toBe("2026-07-27"); // DTEND exklusiv -> inklusiv
  });

  it("korrigiert DTEND vor DTSTART am selben Tag defensiv statt eine negative Dauer zu speichern", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:invert@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T140000",
      "DTEND:20260720T130000",
      "SUMMARY:Kaputte Zeiten",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const a = parseIcs(text).items[0].appointment;
    expect(a.startTime).toBe("14:00");
    expect(a.endTime).toBe("14:00"); // auf den Start gekappt, nicht invertiert
  });

  it("dedupliziert mehrere Serien-Ausnahmen am selben lokalen Tag (höchste SEQUENCE gewinnt)", () => {
    // Anker-Granularität ist der Tag: zwei RECURRENCE-IDs am selben Datum
    // würden sonst am UNIQUE-Index (parent_id, recurrence_anchor) scheitern
    // und den gesamten Import abbrechen.
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:s@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T090000",
      "DTEND:20260720T100000",
      "RRULE:FREQ=HOURLY;COUNT=48",
      "SUMMARY:Stündlich",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:s@example.org",
      "DTSTAMP:20260701T000000Z",
      "RECURRENCE-ID:20260720T110000",
      "DTSTART:20260720T113000",
      "DTEND:20260720T120000",
      "SEQUENCE:2",
      "SUMMARY:Gewinner",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:s@example.org",
      "DTSTAMP:20260701T000000Z",
      "RECURRENCE-ID:20260720T150000",
      "DTSTART:20260720T153000",
      "DTEND:20260720T160000",
      "SEQUENCE:1",
      "SUMMARY:Verlierer",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { items, warnings } = parseIcs(text);
    const overrides = items.filter((i) => i.appointment.parentId !== null);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].appointment.title).toBe("Gewinner");
    expect(warnings.some((w) => w.includes("selben Tag"))).toBe(true);
  });
});

describe("planIcsImport", () => {
  const foreignSeries = (overrideSummary = "Verschoben") =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//DE",
      "BEGIN:VEVENT",
      "UID:ext@example.org",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260720T100000",
      "DTEND:20260720T110000",
      "RRULE:FREQ=WEEKLY",
      "SEQUENCE:1",
      "SUMMARY:Fremdserie",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:ext@example.org",
      "DTSTAMP:20260701T000000Z",
      "RECURRENCE-ID:20260727T100000",
      "DTSTART:20260728T140000",
      "DTEND:20260728T150000",
      "SEQUENCE:2",
      `SUMMARY:${overrideSummary}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

  it("erkennt den Reimport eigener Exporte über die br-log.local-UID (keine Duplikate)", () => {
    const text = buildIcs([appt({ id: "local-1" })], { includeConfidential: false });
    const { items, warnings } = parseIcs(text);
    const plan = planIcsImport({
      items,
      localByUid: new Map(),
      localById: new Map([["local-1", { id: "local-1", icsSequence: 0 }]]),
      localOverrideAnchors: new Map(),
      warnings,
    });
    expect(plan.newCount).toBe(0);
    expect(plan.unchangedCount).toBe(1);
    expect(plan.toSave).toHaveLength(0);
    expect(plan.replaceIds).toHaveLength(0);
  });

  it("übernimmt neue Ausnahmen einer lokal unveränderten importierten Serie einzeln", () => {
    // Google & Co. erhöhen beim Verschieben EINER Instanz nur die SEQUENCE des
    // Override-VEVENTs -- der Master gilt als unverändert, die Ausnahme darf
    // trotzdem nicht still verworfen werden.
    const { items, warnings } = parseIcs(foreignSeries());
    const plan = planIcsImport({
      items,
      localByUid: new Map([["ext@example.org", { id: "local-m", icsSequence: 1 }]]),
      localById: new Map(),
      localOverrideAnchors: new Map([["local-m", new Set<string>()]]),
      warnings,
    });
    expect(plan.unchangedCount).toBe(1); // Master bleibt lokal bestehen
    expect(plan.updatedCount).toBe(1); // die Ausnahme zählt als aktualisiert
    expect(plan.toSave).toHaveLength(1);
    expect(plan.toSave[0].parentId).toBe("local-m"); // auf den lokalen Master umgehängt
    expect(plan.toSave[0].title).toBe("Verschoben");
  });

  it("verwirft eine Ausnahme nicht still, wenn die Instanz lokal bereits bearbeitet ist", () => {
    const { items, warnings } = parseIcs(foreignSeries());
    const plan = planIcsImport({
      items,
      localByUid: new Map([["ext@example.org", { id: "local-m", icsSequence: 1 }]]),
      localById: new Map(),
      localOverrideAnchors: new Map([["local-m", new Set(["2026-07-27"])]]),
      warnings,
    });
    expect(plan.toSave).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("nicht übernommen"))).toBe(true);
  });

  it("meldet beim Reimport eigener Exporte keine Ausnahme-Warnungen", () => {
    // Eigener Export: die Overrides der Datei SIND die lokalen Overrides --
    // stilles Überspringen ist hier korrekt, kein Warn-Spam.
    const master = appt({ id: "local-m", rrule: "FREQ=WEEKLY" });
    const override = appt({
      id: "local-ov",
      parentId: "local-m",
      recurrenceAnchor: "2026-07-27",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
    });
    const text = buildIcs([master, override], { includeConfidential: false });
    const { items, warnings } = parseIcs(text);
    const plan = planIcsImport({
      items,
      localByUid: new Map(),
      localById: new Map([["local-m", { id: "local-m", icsSequence: 0 }]]),
      localOverrideAnchors: new Map([["local-m", new Set(["2026-07-27"])]]),
      warnings,
    });
    expect(plan.toSave).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
    expect(plan.warnings).toEqual([]);
  });
});
