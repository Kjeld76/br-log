import { describe, expect, it } from "vitest";
import { glEntryView } from "./glProjection";
import type { EntryListItem } from "../types";

// Fixture-Muster wie in reportPdf.test.ts / exporters.test.ts.
function entry(overrides: Partial<EntryListItem> = {}): EntryListItem {
  return {
    id: "1",
    date: "2026-06-01",
    startTime: "08:00",
    endTime: "10:00",
    durationMinutes: 120,
    pauseMinutes: 15,
    infoForManagement: "BR-Sitzung",
    hadPlannedShift: true,
    shiftCompensationNote: "Ausgleich am Folgetag",
    isCompensation: false,
    tagIds: ["t1"],
    objections: [
      { id: "o1", reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" },
    ],
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    tagLabels: ["Sitzung"],
    ...overrides,
  };
}

describe("glEntryView", () => {
  it("liefert alle GL-Felder wertgleich zum Eingabe-Item", () => {
    const e = entry();

    expect(glEntryView(e)).toEqual({
      date: "2026-06-01",
      startTime: "08:00",
      endTime: "10:00",
      durationMinutes: 120,
      pauseMinutes: 15,
      infoForManagement: "BR-Sitzung",
      tagLabels: ["Sitzung"],
      hadPlannedShift: true,
      shiftCompensationNote: "Ausgleich am Folgetag",
      isCompensation: false,
      objections: [{ reason: "Frist versäumt", byWhom: "GL", date: "2026-06-02" }],
    });
  });

  it("stellt secretDetails auf Typ-Ebene nicht bereit", () => {
    const view = glEntryView(entry());

    // @ts-expect-error secretDetails ist nicht Teil von GlEntryView -- der
    // Zugriff darf gar nicht erst kompilieren.
    expect(view.secretDetails).toBeUndefined();
  });

  it("CANARY: kopiert Felder explizit statt zu spreaden -- ein künftig auf EntryListItem ergänztes secretDetails darf NIE in die Projektion durchsickern", () => {
    // Simuliert eine künftige Regression: EntryListItem trägt secretDetails
    // heute strukturell nicht (Listen laden es nie), daher hier per
    // Extra-Property-Spread über das Fixture erzwungen.
    const withSecret = {
      ...entry(),
      secretDetails: "VERTRAULICH_CANARY_12345",
    } as EntryListItem;

    const view = glEntryView(withSecret);

    expect(JSON.stringify(view)).not.toContain("VERTRAULICH_CANARY_12345");
  });
});
