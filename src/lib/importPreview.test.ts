import { describe, expect, it } from "vitest";
import type { ImportSummary } from "../types";
import { icsImportPreview, jsonImportPreview } from "./importPreview";

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    newEntries: 3,
    conflicts: 1,
    unchanged: 2,
    newTags: 0,
    conflictItems: [],
    ...overrides,
  };
}

describe("jsonImportPreview", () => {
  it("baut Titel und die vier Basis-Bullets ohne Termin-Anteile", () => {
    const preview = jsonImportPreview(summary());

    expect(preview.title).toBe("Import-Vorschau");
    expect(preview.bullets).toEqual([
      "3 neue Einträge",
      "1 Konflikte (neuere Version gewinnt)",
      "2 unverändert",
      "0 neue Schlagwörter",
    ]);
    expect(preview.detail).toBeUndefined();
  });

  it("ergänzt den Termine-Bullet, sobald die Summe der Termin-Zähler > 0 ist", () => {
    const preview = jsonImportPreview(
      summary({
        newAppointments: 2,
        appointmentConflicts: 1,
        appointmentUnchanged: 0,
      })
    );

    expect(preview.bullets).toEqual([
      "3 neue Einträge",
      "1 Konflikte (neuere Version gewinnt)",
      "2 unverändert",
      "0 neue Schlagwörter",
      "Termine: 2 neu, 1 aktualisiert, 0 unverändert",
    ]);
  });

  it("lässt den Termine-Bullet weg, wenn alle Termin-Zähler 0/undefined sind", () => {
    const preview = jsonImportPreview(
      summary({
        newAppointments: 0,
        appointmentConflicts: 0,
        appointmentUnchanged: 0,
      })
    );

    expect(preview.bullets).toHaveLength(4);
  });

  it("liefert kein detail, wenn conflictItems leer ist", () => {
    const preview = jsonImportPreview(summary({ conflictItems: [] }));

    expect(preview.detail).toBeUndefined();
  });

  it("baut das detail mit Heading und Zeilen aus conflictItems", () => {
    const preview = jsonImportPreview(
      summary({
        conflictItems: [
          { id: "a1", date: "2026-07-01", label: "8h Sitzung" },
          { id: "a2", date: "2026-07-02", label: "4h Schulung" },
        ],
      })
    );

    expect(preview.detail).toEqual({
      heading: "Diese 2 lokalen Einträge würden überschrieben:",
      lines: [
        { strong: "2026-07-01", text: " — 8h Sitzung" },
        { strong: "2026-07-02", text: " — 4h Schulung" },
      ],
    });
  });
});

describe("icsImportPreview", () => {
  it("baut Titel und die drei Bullets", () => {
    const preview = icsImportPreview({
      newCount: 5,
      updatedCount: 2,
      unchangedCount: 1,
      warnings: [],
    });

    expect(preview.title).toBe("ICS-Import-Vorschau");
    expect(preview.bullets).toEqual([
      "5 neue Termine",
      "2 aktualisiert (bestehende Serie/Termin wird ersetzt)",
      "1 unverändert",
    ]);
    expect(preview.detail).toBeUndefined();
  });

  it("liefert kein detail, wenn warnings leer ist", () => {
    const preview = icsImportPreview({
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      warnings: [],
    });

    expect(preview.detail).toBeUndefined();
  });

  it("baut das detail mit Heading 'Hinweise:' aus warnings", () => {
    const preview = icsImportPreview({
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      warnings: ["Ein Termin ohne Startzeitpunkt wurde übersprungen."],
    });

    expect(preview.detail).toEqual({
      heading: "Hinweise:",
      lines: [{ text: "Ein Termin ohne Startzeitpunkt wurde übersprungen." }],
    });
  });
});
