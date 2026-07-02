import { describe, expect, it } from "vitest";
import { toCsv, type CsvColumn } from "./toCsv";

interface Row {
  name: string;
  note: string | null;
}

const columns: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Notiz", value: (r) => r.note },
];

describe("toCsv", () => {
  it("baut Kopfzeile + Datenzeilen mit Semikolon-Trenner und CRLF", () => {
    const csv = toCsv<Row>(
      [
        { name: "Alice", note: "ok" },
        { name: "Bob", note: "" },
      ],
      columns
    );
    const [bomAndHeader, ...rows] = csv.split("\r\n");
    expect(bomAndHeader.replace("﻿", "")).toBe("Name;Notiz");
    expect(rows).toEqual(["Alice;ok", "Bob;"]);
  });

  it("stellt standardmäßig ein UTF-8-BOM voran", () => {
    const csv = toCsv<Row>([{ name: "Alice", note: null }], columns);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("kann das BOM abschalten", () => {
    const csv = toCsv<Row>([{ name: "Alice", note: null }], columns, {
      bom: false,
    });
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.startsWith("Name;Notiz")).toBe(true);
  });

  it("escaped Anführungszeichen, Trenner und Zeilenumbrüche", () => {
    const csv = toCsv<Row>(
      [{ name: 'Sag "Hallo"', note: "Zeile1;Zeile2\nZeile3" }],
      columns,
      { bom: false }
    );
    const dataLine = csv.split("\r\n")[1];
    // Anführungszeichen werden verdoppelt, das Feld selbst in "" gekapselt.
    expect(dataLine).toBe(
      '"Sag ""Hallo"""' + ";" + '"Zeile1;Zeile2\nZeile3"'
    );
  });

  it("behandelt null/undefined als leeren String ohne Quoting", () => {
    const csv = toCsv<Row>([{ name: "Alice", note: null }], columns, {
      bom: false,
    });
    expect(csv.split("\r\n")[1]).toBe("Alice;");
  });

  it("unterstützt einen alternativen Delimiter (löst automatisch Quoting aus)", () => {
    const csv = toCsv<Row>([{ name: "A,B", note: "x" }], columns, {
      delimiter: ",",
      bom: false,
    });
    expect(csv.split("\r\n")[1]).toBe('"A,B",x');
  });
});
