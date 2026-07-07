import { describe, expect, it } from "vitest";
import {
  computeDuration,
  durationFromRange,
  durationInputToMinutes,
  formatDecimalHoursDe,
  parseTimeToMinutes,
  rangesOverlap,
} from "./time";

describe("parseTimeToMinutes", () => {
  it("parst HH:MM in Minuten", () => {
    expect(parseTimeToMinutes("08:30")).toBe(510);
    expect(parseTimeToMinutes("0:00")).toBe(0);
  });

  it("liefert null bei fehlender/leerer/ungültiger Eingabe", () => {
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes("24:00")).toBeNull(); // Stunde > 23
    expect(parseTimeToMinutes("12:60")).toBeNull(); // Minute > 59
    expect(parseTimeToMinutes("abc")).toBeNull();
  });
});

describe("durationFromRange", () => {
  it("berechnet die Dauer innerhalb eines Tages", () => {
    expect(durationFromRange("08:00", "16:30")).toBe(510);
  });

  it("interpretiert einen negativen Zeitraum als Folgetag (Mitternachts-Annahme)", () => {
    // Bewusst dokumentiertes Verhalten: Bis < Von -> +24h statt Fehler.
    expect(durationFromRange("22:00", "06:00")).toBe(8 * 60);
  });

  it("liefert null bei unvollständiger Eingabe", () => {
    expect(durationFromRange(null, "10:00")).toBeNull();
    expect(durationFromRange("10:00", null)).toBeNull();
  });
});

describe("computeDuration", () => {
  it("berechnet die Dauer bei gültigem Von < Bis", () => {
    expect(computeDuration("08:00", "16:30")).toEqual({
      minutes: 510,
      error: null,
      overnight: false,
    });
  });

  it("wertet Bis < Von als Schicht über Mitternacht (Folgetag, kein Fehler)", () => {
    // Gewollte Semantik seit #18: Nachtschichten sind bei BR-Zeiten Alltag,
    // daher keine +24h-Annahme mehr strikt ablehnen, sondern übernehmen.
    expect(computeDuration("22:00", "06:00")).toEqual({
      minutes: 8 * 60,
      error: null,
      overnight: true,
    });
    expect(computeDuration("23:30", "00:15")).toEqual({
      minutes: 45,
      error: null,
      overnight: true,
    });
  });

  it("liefert einen Fehler bei Nullzeitraum (Von === Bis)", () => {
    expect(computeDuration("10:00", "10:00")).toEqual({
      minutes: null,
      error: "Die Dauer muss größer als 0 sein.",
      overnight: false,
    });
  });

  it("liefert kein Ergebnis (weder Wert noch Fehler) bei unvollständiger Eingabe", () => {
    expect(computeDuration(null, "10:00")).toEqual({
      minutes: null,
      error: null,
      overnight: false,
    });
    expect(computeDuration("10:00", null)).toEqual({
      minutes: null,
      error: null,
      overnight: false,
    });
  });

  describe("mit Pause (pauseMinutes)", () => {
    it("zieht die Pause von der Brutto-Spanne ab (Netto-Dauer)", () => {
      expect(computeDuration("08:00", "16:00", 30)).toEqual({
        minutes: 450, // 480 - 30
        error: null,
        overnight: false,
      });
    });

    it("verhält sich ohne Pause-Argument wie zuvor (Default 0, Rückwärtskompatibilität)", () => {
      expect(computeDuration("08:00", "16:00")).toEqual({
        minutes: 480,
        error: null,
        overnight: false,
      });
    });

    it("zieht die Pause auch bei einer Über-Mitternacht-Schicht ab", () => {
      expect(computeDuration("22:00", "06:00", 60)).toEqual({
        minutes: 420, // 480 - 60
        error: null,
        overnight: true,
      });
    });

    it("liefert einen Fehler, wenn die Pause mindestens so lang ist wie die Schicht", () => {
      expect(computeDuration("08:00", "09:00", 60)).toEqual({
        minutes: null,
        error: "Die Pause ist länger als die Schicht.",
        overnight: false,
      });
      expect(computeDuration("08:00", "09:00", 90)).toEqual({
        minutes: null,
        error: "Die Pause ist länger als die Schicht.",
        overnight: false,
      });
    });

    it("klemmt eine negative Pause defensiv auf 0, statt einen Fehler zu werfen", () => {
      expect(computeDuration("08:00", "16:00", -30)).toEqual({
        minutes: 480,
        error: null,
        overnight: false,
      });
    });
  });
});

describe("durationInputToMinutes", () => {
  it("parst H:MM-Eingaben", () => {
    expect(durationInputToMinutes("1:30")).toBe(90);
    expect(durationInputToMinutes("120:00")).toBe(7200);
  });

  it("parst reine Minutenzahlen", () => {
    expect(durationInputToMinutes("45")).toBe(45);
    expect(durationInputToMinutes("0")).toBe(0);
  });

  it("liefert null bei leerer oder ungültiger Eingabe", () => {
    expect(durationInputToMinutes("")).toBeNull();
    expect(durationInputToMinutes("  ")).toBeNull();
    expect(durationInputToMinutes("1:60")).toBeNull(); // Minute > 59
    expect(durationInputToMinutes("abc")).toBeNull();
    expect(durationInputToMinutes("1:2:3")).toBeNull();
  });
});

describe("formatDecimalHoursDe", () => {
  it("formatiert Dezimalstunden mit Komma statt Punkt (Finding 11)", () => {
    expect(formatDecimalHoursDe(90)).toBe("1,50");
    expect(formatDecimalHoursDe(60)).toBe("1,00");
    expect(formatDecimalHoursDe(45)).toBe("0,75");
  });

  it("rundet auf zwei Nachkommastellen", () => {
    expect(formatDecimalHoursDe(100)).toBe("1,67"); // 100/60 = 1.6666...
  });

  it("liefert kein Punkt-Zeichen (Excel-DE-Falle)", () => {
    expect(formatDecimalHoursDe(90)).not.toContain(".");
  });
});

describe("rangesOverlap", () => {
  it("erkennt Überschneidung am selben Tag", () => {
    expect(
      rangesOverlap(
        { date: "2026-07-02", start: "09:00", end: "11:00" },
        { date: "2026-07-02", start: "10:00", end: "12:00" }
      )
    ).toBe(true);
  });

  it("erkennt keine Überschneidung bei direkt aneinandergrenzenden Zeiträumen", () => {
    expect(
      rangesOverlap(
        { date: "2026-07-02", start: "09:00", end: "11:00" },
        { date: "2026-07-02", start: "11:00", end: "12:00" }
      )
    ).toBe(false);
  });

  it("erkennt keine Überschneidung an verschiedenen Tagen ohne Mitternachts-Bezug", () => {
    expect(
      rangesOverlap(
        { date: "2026-07-01", start: "09:00", end: "11:00" },
        { date: "2026-07-02", start: "09:00", end: "11:00" }
      )
    ).toBe(false);
  });

  it("erkennt Überschneidung, wenn eine Über-Mitternacht-Schicht in den Folgetag reicht", () => {
    // Schicht 01.07. 22:00 -> Folgetag 06:00 überschneidet sich mit 02.07. 05:00-07:00.
    expect(
      rangesOverlap(
        { date: "2026-07-01", start: "22:00", end: "06:00" },
        { date: "2026-07-02", start: "05:00", end: "07:00" }
      )
    ).toBe(true);
  });

  it("liefert false bei unvollständigen Zeiten", () => {
    expect(
      rangesOverlap(
        { date: "2026-07-02", start: "09:00", end: "" },
        { date: "2026-07-02", start: "09:00", end: "10:00" }
      )
    ).toBe(false);
  });
});
