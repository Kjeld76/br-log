import { describe, expect, it } from "vitest";
import {
  buildReportModel,
  renderReportPdf,
  toAutoTableInput,
  uint8ToBase64,
  type ReportModel,
} from "./reportPdf";
import type { EntryListItem } from "../types";

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

const joinTags = (e: EntryListItem) => e.tagLabels.join(", ");

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
    });

    expect(model.compensationLabel).toBe("keiner.");
  });

  it("beschriftet einen offenen Zeitraum mit Anfang/Ende", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
    });

    expect(model.periodLabel).toBe("Anfang – Ende");
  });

  it("beschriftet einen konkreten Zeitraum deutsch formatiert", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "2026-06-01",
      to: "2026-06-30",
    });

    expect(model.periodLabel).toBe("Mo., 01.06.2026 – Di., 30.06.2026");
    expect(model.fileBaseName).toBe("BR-Nachweis_2026-06-01_bis_2026-06-30");
  });

  it("verwendet das heutige ISO-Datum als Dateinamen, wenn kein Zeitraum gewählt ist", () => {
    const model = buildReportModel([], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
    });

    // todayIso() liefert YYYY-MM-DD -- ohne Zeitraumauswahl trägt der
    // Dateiname exakt dieses Format als Suffix (siehe fileBaseName in
    // reportPdf.ts), unabhängig vom injizierten createdAt (das nur die
    // Anzeige "Erstellt am" betrifft, nicht den Dateinamen).
    expect(model.fileBaseName).toMatch(/^BR-Nachweis_\d{4}-\d{2}-\d{2}$/);
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
    });

    expect(model.rows.map((r) => r.date)).toEqual([
      "Mo., 01.06.2026",
      "Mo., 15.06.2026",
    ]);
  });
});

describe("toAutoTableInput", () => {
  it("liefert Kopf- und Datenzeilen in der von jspdf-autotable erwarteten {head, body}-Struktur", () => {
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
    });

    const input = toAutoTableInput(model);

    expect(input).toMatchSnapshot();
  });

  it("bildet jede Zeile in derselben Spaltenreihenfolge wie die Kopfzeile ab", () => {
    const entries = [entry({ tagLabels: ["Ausschuss"] })];
    const model = buildReportModel(entries, joinTags, {
      name: "Mario König",
      from: "",
      to: "",
    });

    const { head, body } = toAutoTableInput(model);

    expect(head[0]).toEqual(model.columns);
    expect(body[0]).toHaveLength(head[0].length);
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

  it("CANARY: secretDetails auf einem Listen-Item (künftige Regression -- EntryListItem trägt es heute strukturell nicht) landet weder als Roh-Bytes noch als Latin1-String im PDF", () => {
    const withSecret = {
      ...entry({ infoForManagement: "BR-Sitzung" }),
      secretDetails: "VERTRAULICH_CANARY_12345",
    } as EntryListItem;

    const model = buildReportModel([withSecret], joinTags, {
      name: "Mario König",
      from: "",
      to: "",
    });
    const bytes = renderReportPdf(model);

    expect(containsAsciiBytes(bytes, "VERTRAULICH_CANARY_12345")).toBe(false);
    expect(toLatin1String(bytes)).not.toContain("VERTRAULICH_CANARY_12345");
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
