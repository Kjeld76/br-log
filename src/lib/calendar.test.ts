import { describe, expect, it } from "vitest";
import { addDaysIso, formatDateDe, monthLabel, weekRangeIso } from "./calendar";

describe("addDaysIso", () => {
  it("addiert Kalendertage über Monats- und Jahresgrenzen", () => {
    expect(addDaysIso("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysIso("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("monthLabel", () => {
  it("formatiert den Monat deutsch (Finding 28: kein 'July 2026')", () => {
    const label = monthLabel(new Date(2026, 6, 15)); // Juli 2026
    expect(label).toBe("Juli 2026");
    expect(label).not.toContain("July");
  });
});

describe("weekRangeIso", () => {
  it("liefert die Woche Montag–Sonntag (weekStartsOn: 1)", () => {
    // Donnerstag, 02.07.2026 -> Woche Mo 29.06. bis So 05.07.
    const { from, to } = weekRangeIso(new Date(2026, 6, 2));
    expect(from).toBe("2026-06-29");
    expect(to).toBe("2026-07-05");
  });

  it("liegt an einem Montag selbst am Wochenanfang", () => {
    const { from, to } = weekRangeIso(new Date(2026, 5, 29)); // Montag
    expect(from).toBe("2026-06-29");
    expect(to).toBe("2026-07-05");
  });
});

describe("formatDateDe", () => {
  it("formatiert ein ISO-Datum ins deutsche Kurzformat inkl. Wochentag", () => {
    expect(formatDateDe("2026-07-02")).toBe("Do., 02.07.2026");
  });

  it("gibt ungültige Eingaben unverändert zurück statt 'Invalid Date'", () => {
    expect(formatDateDe("kaputt")).toBe("kaputt");
  });
});
