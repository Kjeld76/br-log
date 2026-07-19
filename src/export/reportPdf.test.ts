import { describe, expect, it } from "vitest";
import {
  buildObjectionsBlockLayout,
  buildReportModel,
  renderReportPdf,
  toAutoTableInput,
  uint8ToBase64,
  type ReportModel,
  type ReportTableRow,
} from "./reportPdf";
import type { EntryListItem } from "../types";
import type { GlEntryView } from "./glProjection";

// Kein PDF-Byte-Snapshot (siehe reportPdf.ts-Kommentar) -- getestet wird
// ausschließlich das reine Modell (buildReportModel) und die daraus
// abgeleitete autotable-Eingabestruktur (toAutoTableInput).

function entry(overrides: Partial<EntryListItem> = {}): EntryListItem {
  return {
    id: overrides.id ?? "1",
    date: "2026-06-01",
    startTime: "08:00",
    endTime: "10:00",
    durationMinutes: 120,
    pauseMinutes: 0,
    infoForManagement: "BR-Sitzung",
    hadPlannedShift: false,
    shiftCompensationNote: "",
    isCompensation: false,
    tagIds: [],
    objections: [],
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    tagLabels: [],
    ...overrides,
  };
}

const joinTags = (v: GlEntryView) => v.tagLabels.join(", ");

function dayRowKinds(model: ReportModel): ReportTableRow["kind"][] {
  return model.dayRows.map((r) => r.kind);
}

function summaryLabels(model: ReportModel): string[] {
  return model.dayRows
    .filter((r) => r.kind === "day-summary")
    .map((r) => (r as Extract<ReportTableRow, { kind: "day-summary" }>).label);
}

describe("buildReportModel", () => {
  it("summiert die Arbeitszeit ausschließlich über Nicht-Freizeitausgleich-Einträge", () => {
    const entries = [
      entry({ id: "a", durationMinutes: 120 }),
      entry({ id: "b", durationMinutes: 90 }),
      entry({ id: "c", durationMinutes: 60, isCompensation: true }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows).toHaveLength(2);
    expect(model.totalValue).toBe("3:30 Std");
  });

  it("trennt Freizeitausgleich-Einträge in eine eigene Zusammenfassungszeile statt sie in die Tabelle/Summe zu mischen", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-05", durationMinutes: 480, isCompensation: true }),
      entry({ id: "b", date: "2026-06-10", durationMinutes: 240, isCompensation: true }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows).toHaveLength(0);
    expect(model.totalValue).toBe("0:00 Std");
    expect(model.compensationLabel).toBe(
      "12:00 Std an 2 Tag(en) (Fr., 05.06.2026, Mi., 10.06.2026)"
    );
  });

  it('zeigt "keiner." als Freizeitausgleich-Zeile, wenn keine Ausgleichseinträge vorliegen', () => {
    const model = buildReportModel([entry()], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.compensationLabel).toBe("keiner.");
  });

  it("beschriftet einen offenen Zeitraum mit Anfang/Ende", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.periodLabel).toBe("Anfang – Ende");
  });

  it("beschriftet einen konkreten Zeitraum deutsch formatiert", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.periodLabel).toBe("Mo., 01.06.2026 – Di., 30.06.2026");
    // 2026-06-01..2026-06-30 ist ein voller Kalendermonat -> Monatsmodus im
    // Dateinamen (siehe fileBaseName-Tests unten); ohne Nachname kein Suffix.
    expect(model.fileBaseName).toBe("BR-Stundennachweis_2026-06");
  });

  it("verwendet das heutige ISO-Datum als Dateinamen, wenn kein Zeitraum gewählt ist", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    // todayIso() liefert YYYY-MM-DD -- ohne Zeitraumauswahl trägt der
    // Dateiname exakt dieses Format als Suffix (siehe fileBaseName in
    // reportPdf.ts), unabhängig vom injizierten createdAt (das nur die
    // Anzeige "Erstellt am" betrifft, nicht den Dateinamen).
    expect(model.fileBaseName).toMatch(/^BR-Stundennachweis_\d{4}-\d{2}-\d{2}$/);
  });

  it("erhält Umlaute in Name, Info und Schlagwörtern unverändert im Modell", () => {
    const entries = [
      entry({
        infoForManagement: "Gespräch mit Geschäftsführung über Überstunden",
        tagLabels: ["Schulung", "Fahrzeit für Prüfungsvorbereitung"],
      }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Björn Müller",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.name).toBe("Björn Müller");
    expect(model.rows[0].info).toBe(
      "Gespräch mit Geschäftsführung über Überstunden"
    );
    expect(model.rows[0].tags).toBe("Schulung, Fahrzeit für Prüfungsvorbereitung");
  });

  it("fällt bei leerem Namen auf einen Platzhalter zurück", () => {
    const model = buildReportModel([], joinTags, {
      name: "   ",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.name).toBe("—");
  });

  it("übernimmt pauseMinutes je Zeile als String-Spalte (Konsistenz mit CSV-Export)", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-01", pauseMinutes: 30 }),
      entry({ id: "b", date: "2026-06-02", pauseMinutes: 0 }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows.map((r) => r.pause)).toEqual(["30", "0"]);
  });

  it("markiert die geplante Schicht je Zeile als ja/nein", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-01", hadPlannedShift: true }),
      entry({ id: "b", date: "2026-06-02", hadPlannedShift: false }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows.map((r) => r.shift)).toEqual(["ja", "nein"]);
  });

  it("sortiert die Zeilen aufsteigend nach Datum, unabhängig von der Eingabereihenfolge", () => {
    const entries = [
      entry({ id: "b", date: "2026-06-15" }),
      entry({ id: "a", date: "2026-06-01" }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows.map((r) => r.date)).toEqual([
      "Mo., 01.06.2026",
      "Mo., 15.06.2026",
    ]);
  });
});

describe("buildReportModel: Tagessummen (dayRows)", () => {
  it("fügt nach jedem Tag eine Summenzeile mit exakter Tagesminutensumme ein, zusätzlich zur Gesamtsumme", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-01", durationMinutes: 90 }),
      entry({ id: "b", date: "2026-06-01", durationMinutes: 30 }),
      entry({ id: "c", date: "2026-06-02", durationMinutes: 60 }),
      entry({ id: "d", date: "2026-06-02", durationMinutes: 15 }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    // 2 Tage à 2 Einträge -> 2 Summenzeilen, Minuten exakt (90+30=120 -> 2:00,
    // 60+15=75 -> 1:15), Reihenfolge: Eintrag, Eintrag, Summe je Tag.
    expect(summaryLabels(model)).toEqual([
      "Summe 01.06.2026 — 2:00",
      "Summe 02.06.2026 — 1:15",
    ]);
    expect(dayRowKinds(model)).toEqual([
      "entry",
      "entry",
      "day-summary",
      "entry",
      "entry",
      "day-summary",
    ]);
    // Gesamtsumme bleibt (unabhängig von den Tagessummen weiterhin korrekt).
    expect(model.totalValue).toBe("3:15 Std");
  });

  it("verwendet dieselbe Minutenarithmetik/Formatierung wie minutesToHhmm (App-Summen), auch bei einem einzigen Tag", () => {
    const entries = [entry({ id: "a", date: "2026-06-03", durationMinutes: 125 })];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(summaryLabels(model)).toEqual(["Summe 03.06.2026 — 2:05"]);
  });

  it("erzeugt keine Summenzeilen, wenn keine Arbeitszeit-Einträge vorliegen", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.dayRows).toEqual([]);
  });
});

describe("buildReportModel: Widerspruchs-Kennzeichnung", () => {
  // Finding C2 (empirisch belegt): "⚠" (U+26A0) schaltet jsPDF intern von
  // WinAnsi auf UTF-16BE um, Helvetica bleibt aber WinAnsi-kodiert -- alle
  // Zeichen NACH dem Suffix wurden dadurch zu Zeichensalat. Das Suffix ist
  // deshalb reines ASCII (" *"); die Legende dazu steht als erste Zeile im
  // Widerspruchs-Block (siehe nächster Test).
  it("kennzeichnet Zeilen mit Widerspruch durch das Suffix ' *' in der Datums-Zelle", () => {
    const entries = [
      entry({
        id: "a",
        date: "2026-06-01",
        objections: [
          { id: "o1", reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" },
        ],
      }),
      entry({ id: "b", date: "2026-06-03", objections: [] }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.rows[0].date).toBe("Mo., 01.06.2026 *");
    expect(model.rows[1].date).toBe("Mi., 03.06.2026");
  });

  it("listet Widersprüche unter der Tabelle als 'TT.MM.JJJJ — Begründung (Name)' je Zeile, mit der Legende zum ' *'-Suffix als erster Zeile", () => {
    const entries = [
      entry({
        id: "a",
        date: "2026-06-01",
        objections: [
          { id: "o1", reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" },
        ],
      }),
      entry({
        id: "b",
        date: "2026-06-05",
        objections: [
          { id: "o2", reason: "Unklare Angabe", byWhom: "Team GL", date: "2026-06-06" },
        ],
      }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.objectionLines).toEqual([
      "* = Eintrag mit Widerspruch",
      "02.06.2026 — Frist versäumt (GL)",
      "06.06.2026 — Unklare Angabe (Team GL)",
    ]);
  });

  it("liefert eine leere Widerspruchsliste, wenn kein Eintrag widersprochen wurde", () => {
    const model = buildReportModel([entry({ objections: [] })], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.objectionLines).toEqual([]);
  });

  it("fällt bei fehlendem Widerspruchsdatum auf 'ohne Datum' zurück", () => {
    const entries = [
      entry({
        objections: [
          { id: "o1", reason: "Zu spät gemeldet", byWhom: "Team GL", date: null },
        ],
      }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.objectionLines).toEqual([
      "* = Eintrag mit Widerspruch",
      "ohne Datum — Zu spät gemeldet (Team GL)",
    ]);
  });
});

describe("buildReportModel: Kopfzeilen Funktion/Betrieb", () => {
  it("übernimmt Funktion und Betrieb als zusätzliche Kopfzeilen, wenn beide gesetzt sind", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "BR-Vorsitzender",
      betrieb: "Musterwerk GmbH",
      nachname: "",
      showTags: true,
    });

    expect(model.headerExtras).toEqual([
      { label: "Funktion", value: "BR-Vorsitzender" },
      { label: "Betrieb/Firma", value: "Musterwerk GmbH" },
    ]);
  });

  it("lässt leere oder nur aus Leerzeichen bestehende Funktion/Betrieb als Kopfzeile ganz weg", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "   ",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.headerExtras).toEqual([]);
  });

  it("übernimmt nur die tatsächlich gesetzte der beiden Kopfzeilen", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "Musterwerk GmbH",
      nachname: "",
      showTags: true,
    });

    expect(model.headerExtras).toEqual([{ label: "Betrieb/Firma", value: "Musterwerk GmbH" }]);
  });

  it("lässt beide Kopfzeilen weg, wenn funktion/betrieb gar nicht übergeben werden", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.headerExtras).toEqual([]);
  });
});

describe("buildReportModel: fileBaseName", () => {
  it("Monatsmodus (from/to = voller Kalendermonat) -> BR-Stundennachweis_JJJJ-MM_Nachname", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
      nachname: "König",
      funktion: "",
      betrieb: "",
      showTags: true,
    });

    expect(model.fileBaseName).toBe("BR-Stundennachweis_2026-06_König");
  });

  it("freier Zeitraum (kein voller Kalendermonat) -> BR-Stundennachweis_JJJJ-MM-TT_bis_JJJJ-MM-TT_Nachname", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-05",
      to: "2026-06-20",
      nachname: "König",
      funktion: "",
      betrieb: "",
      showTags: true,
    });

    expect(model.fileBaseName).toBe("BR-Stundennachweis_2026-06-05_bis_2026-06-20_König");
  });

  it("ein Monatswechsel-Zeitraum ist trotz identischer Tageszahl kein voller Kalendermonat", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-15",
      to: "2026-07-14",
      nachname: "König",
      funktion: "",
      betrieb: "",
      showTags: true,
    });

    expect(model.fileBaseName).toBe("BR-Stundennachweis_2026-06-15_bis_2026-07-14_König");
  });

  it("ohne Nachname entfällt das Suffix samt Unterstrich", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.fileBaseName).toBe("BR-Stundennachweis_2026-06");
  });

  it("ersetzt dateisystemkritische Sonderzeichen im Nachnamen durch '-', erhält Umlaute", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
      nachname: 'Müller/Schön:Schmidt*Ärger?"<>|',
      funktion: "",
      betrieb: "",
      showTags: true,
    });

    expect(model.fileBaseName).toBe(
      "BR-Stundennachweis_2026-06_Müller-Schön-Schmidt-Ärger-----"
    );
  });
});

describe("buildReportModel: showTags", () => {
  it("zeigt die Schlagwörter-Spalte standardmäßig (showTags default true)", () => {
    const model = buildReportModel([entry({ tagLabels: ["Sitzung"] })], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(model.columns).toContain("Schlagwörter");
    expect(model.rows[0].tags).toBe("Sitzung");
  });

  it("lässt die Schlagwörter-Spalte in COLUMNS und den Tabellenzeilen weg, wenn showTags=false", () => {
    const entries = [entry({ tagLabels: ["Sitzung"] })];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: false,
    });

    expect(model.columns).toEqual([
      "Datum",
      "Von",
      "Bis",
      "Pause (Min)",
      "Dauer",
      "Info für Geschäftsleitung",
      "Geplante Schicht",
    ]);

    const { head, body } = toAutoTableInput(model);
    expect(head[0]).toEqual(model.columns);
    // Eintragszeile (erste dayRow) hat dieselbe Zellenzahl wie die Kopfzeile,
    // also keine Schlagwörter-Zelle mehr.
    expect(body[0]).toHaveLength(model.columns.length);
  });
});

describe("buildReportModel: tagLabels-Projektor (M1)", () => {
  // Finding M1: `tags: tagLabels(e)` reichte bislang das ROHE Listen-Item an
  // den Projektor durch, nicht die GL-Sicht -- der Doc-Kommentar "Die Zeilen
  // lesen ausschließlich aus glEntryView(e)" stimmte an dieser einen Stelle
  // nicht. Der Projektor bekommt jetzt dieselbe GlEntryView wie alle anderen
  // Felder der Zeile.
  it("übergibt dem tagLabels-Projektor die GlEntryView (ohne rohe Zusatzfelder wie secretDetails), nicht das rohe Listen-Item", () => {
    let received: GlEntryView | undefined;
    const spy = (view: GlEntryView) => {
      received = view;
      return view.tagLabels.join(", ");
    };
    const withExtraField = {
      ...entry({ tagLabels: ["Sitzung"] }),
      secretDetails: "SHOULD_NOT_LEAK",
    } as EntryListItem;

    const model = buildReportModel([withExtraField], spy, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(received).toBeDefined();
    expect(
      (received as unknown as { secretDetails?: string }).secretDetails
    ).toBeUndefined();
    expect(received?.tagLabels).toEqual(["Sitzung"]);
    expect(model.rows[0].tags).toBe("Sitzung");
  });
});

describe("toAutoTableInput", () => {
  it("liefert Kopf- und Datenzeilen (inkl. Tagessumme) in der von jspdf-autotable erwarteten {head, body}-Struktur", () => {
    const entries = [
      entry({
        id: "a",
        date: "2026-06-01",
        startTime: "08:00",
        endTime: "10:00",
        durationMinutes: 120,
        infoForManagement: "BR-Sitzung",
        hadPlannedShift: true,
        tagLabels: ["Sitzung"],
      }),
    ];
    const model: ReportModel = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
      createdAt: "2026-07-02",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    const input = toAutoTableInput(model);

    expect(input).toMatchSnapshot();
  });

  it("bildet jede Eintragszeile in derselben Spaltenreihenfolge wie die Kopfzeile ab", () => {
    const entries = [entry({ tagLabels: ["Ausschuss"] })];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    const { head, body } = toAutoTableInput(model);

    expect(head[0]).toEqual(model.columns);
    expect(body[0]).toHaveLength(head[0].length);
  });

  it("rendert eine Tagessummenzeile als einzelne über alle Spalten gespannte Zelle", () => {
    const entries = [entry({ date: "2026-06-01", durationMinutes: 90 })];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    const { body } = toAutoTableInput(model);

    expect(body).toHaveLength(2); // Eintragszeile + Summenzeile
    expect(body[1]).toEqual([
      { content: "Summe 01.06.2026 — 1:30", colSpan: model.columns.length },
    ]);
  });

  // Finding C1: totalLabel/totalValue standen bislang nur im Modell, wurden
  // aber nirgends gedruckt -- die Vorschau (PrintReportPanel.tsx) zeigt die
  // Summe in ihrem <tfoot>, das PDF gar nicht. Fix: autotable bekommt ein
  // `foot` mit genau dieser Summe, eine über alle Spalten gespannte Zelle
  // (analog zu den bereits vorhandenen Tagessummen-Zeilen im `body`).
  it("liefert eine Fußzeile mit der Monatssumme als eine über alle Spalten gespannte Zelle (C1)", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-01", durationMinutes: 90 }),
      entry({ id: "b", date: "2026-06-02", durationMinutes: 120 }),
    ];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    const { foot } = toAutoTableInput(model);

    expect(foot).toEqual([
      [
        {
          content: `${model.totalLabel}: ${model.totalValue}`,
          colSpan: model.columns.length,
        },
      ],
    ]);
  });
});

describe("buildObjectionsBlockLayout (I2)", () => {
  // Finding I2: der Widerspruchs-Block nahm bislang pauschal EINE Druckzeile
  // pro Widerspruch an (`footerY += 5` je Eintrag), obwohl `doc.text(..., {
  // maxWidth })` lange Begründungen intern in mehrere Zeilen umbricht, ohne
  // dass footerY entsprechend mitwandert -- Folgezeilen überlappten sich.
  // `buildObjectionsBlockLayout` bekommt die Umbruch-Funktion injiziert
  // (`splitToLines`), damit sie ohne echtes jsPDF-Dokument testbar bleibt --
  // die tatsächliche Zeilenbreite hängt von Font/Fontgröße ab, die nur ein
  // echtes Dokument kennt.
  it("gibt jede Zeile unverändert durch und berechnet die Blockhöhe aus genau dieser (unveränderten) Zeilenzahl, wenn splitToLines nicht umbricht", () => {
    const { printLines, blockHeight } = buildObjectionsBlockLayout(
      ["Zeile 1", "Zeile 2"],
      (line) => [line]
    );

    expect(printLines).toEqual(["Zeile 1", "Zeile 2"]);
    expect(blockHeight).toBe(6 + 2 * 5 + 2);
  });

  it("zählt umgebrochene Zeilen einzeln in printLines UND in der Blockhöhe, nicht nur die Rohanzahl der Widersprüche", () => {
    const { printLines, blockHeight } = buildObjectionsBlockLayout(
      ["kurz", "eine sehr lange Begründung, die umbricht"],
      (line) =>
        line === "kurz" ? [line] : ["eine sehr lange Begründung,", "die umbricht"]
    );

    expect(printLines).toEqual([
      "kurz",
      "eine sehr lange Begründung,",
      "die umbricht",
    ]);
    // 1 (kurz) + 2 (umgebrochen) = 3 Druckzeilen -- NICHT 2 (Rohanzahl der
    // Widersprüche), sonst reicht die Seitenumbruch-Schätzung wieder nicht.
    expect(blockHeight).toBe(6 + 3 * 5 + 2);
  });

  it("liefert Blockhöhe 0 und keine Druckzeilen bei leerer Widerspruchsliste, ohne splitToLines aufzurufen", () => {
    const { printLines, blockHeight } = buildObjectionsBlockLayout([], () => {
      throw new Error("splitToLines darf bei leerer Liste nie aufgerufen werden");
    });

    expect(printLines).toEqual([]);
    expect(blockHeight).toBe(0);
  });
});

describe("renderReportPdf", () => {
  // Latin1-Dekodierung wie uint8ToBase64.ts (chunkweise -- vermeidet das
  // Aufrufstack-Limit von String.fromCharCode(...bytes) bei größeren PDFs).
  function toLatin1String(bytes: Uint8Array): string {
    let s = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      s += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return s;
  }

  // Roh-Byte-Suche unabhängig von jeder Zeichenkodierungs-Annahme: sucht die
  // ASCII-Codes des Canary-Markers direkt in der Byte-Sequenz.
  function containsAsciiBytes(haystack: Uint8Array, needle: string): boolean {
    const pattern = Array.from(needle, (c) => c.charCodeAt(0));
    outer: for (let i = 0; i <= haystack.length - pattern.length; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (haystack[i + j] !== pattern[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  // Finding I3: das Canary-Fixture lief bislang OHNE Widerspruch und OHNE
  // Funktion/Betrieb -- der Widerspruchs-Block und die Kopf-Zusatzzeilen
  // (jeweils eigene doc.text-Aufrufe im Footer) liefen im Canary-Rendering
  // also nie mit. Erweitert um genau das, PLUS eine Positivkontrolle: ohne
  // sie würde der Negativtest (Zeilen 840f.) still erblinden, sobald das PDF
  // z. B. künftig mit `compress: true` erzeugt würde -- dann fänden sich
  // WEDER der Canary-String NOCH irgendein anderer Klartext mehr in den
  // Roh-Bytes, und der Test würde fälschlich weiter grün bleiben.
  it("CANARY: secretDetails auf einem Listen-Item (künftige Regression -- EntryListItem trägt es heute strukturell nicht) landet weder als Roh-Bytes noch als Latin1-String im PDF", () => {
    const withSecret = {
      ...entry({
        infoForManagement: "BR-Sitzung",
        objections: [
          { id: "o1", reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" },
        ],
      }),
      secretDetails: "VERTRAULICH_CANARY_12345",
    } as EntryListItem;

    const model = buildReportModel([withSecret], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "BR-Vorsitzender",
      betrieb: "Musterwerk GmbH",
      nachname: "",
      showTags: true,
    });
    const bytes = renderReportPdf(model);

    expect(containsAsciiBytes(bytes, "VERTRAULICH_CANARY_12345")).toBe(false);
    expect(toLatin1String(bytes)).not.toContain("VERTRAULICH_CANARY_12345");

    // Positivkontrolle: ein sicher vorhandener, sichtbarer String MUSS
    // gefunden werden -- belegt, dass containsAsciiBytes/toLatin1String
    // tatsächlich gegen lesbaren PDF-Inhalt prüfen, nicht gegen leere oder
    // komprimierte Bytes.
    expect(containsAsciiBytes(bytes, "BR-Sitzung")).toBe(true);
  });

  it("rendert ohne zu werfen, wenn Widersprüche, Kopf-Zusatzzeilen und Tagessummen gemeinsam vorkommen", () => {
    const entries = [
      entry({
        id: "a",
        date: "2026-06-01",
        objections: [{ id: "o1", reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" }],
      }),
      entry({ id: "b", date: "2026-06-02" }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "BR-Vorsitzender",
      betrieb: "Musterwerk GmbH",
      nachname: "",
      showTags: true,
    });

    expect(() => renderReportPdf(model)).not.toThrow();
  });

  // Finding C1: totalLabel/totalValue standen bislang nur im Modell, ohne je
  // gedruckt zu werden.
  it("druckt die Monatssumme als sichtbaren String im PDF", () => {
    const entries = [
      entry({ id: "a", date: "2026-06-01", durationMinutes: 90 }),
      entry({ id: "b", date: "2026-06-02", durationMinutes: 120 }),
    ];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    const bytes = renderReportPdf(model);

    expect(containsAsciiBytes(bytes, model.totalValue)).toBe(true);
  });

  // Finding I2: eine lange Widerspruchsbegründung, die intern umbricht, darf
  // die Seitenumbruch-Schätzung nicht mehr unterlaufen (vorher: pauschal
  // eine Zeile pro Widerspruch angenommen) -- reines Rauchtest-Kriterium
  // (kein Wurf), die eigentliche Arithmetik prüft buildObjectionsBlockLayout
  // oben isoliert.
  it("rendert ohne zu werfen, wenn eine Widerspruchsbegründung sehr lang ist und intern umbricht", () => {
    const longReason =
      "Diese Begründung ist absichtlich sehr lang, damit sie beim Rendern " +
      "innerhalb der Seitenbreite garantiert in mehrere Zeilen umgebrochen " +
      "wird und die Seitenumbruch-Schätzung des Widerspruchs-Blocks auf die " +
      "Probe stellt, statt nur eine einzige kurze Zeile anzunehmen.";
    const entries = [
      entry({
        id: "a",
        date: "2026-06-01",
        objections: [{ id: "o1", reason: longReason, byWhom: "GL", date: "2026-06-02" }],
      }),
    ];

    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
      funktion: "",
      betrieb: "",
      nachname: "",
      showTags: true,
    });

    expect(() => renderReportPdf(model)).not.toThrow();
  });
});

describe("uint8ToBase64", () => {
  it("kodiert Bytes verlustfrei (Rundreise über atob nachprüfbar)", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const b64 = uint8ToBase64(bytes);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("verarbeitet auch größere Byte-Mengen über die Chunk-Grenze hinweg (0x8000)", () => {
    const bytes = new Uint8Array(0x8000 + 10).map((_, i) => i % 256);
    const b64 = uint8ToBase64(bytes);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
