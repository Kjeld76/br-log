import { describe, expect, it } from "vitest";
import {
  addMinutesToTime,
  computeDuration,
  durationFromRange,
  durationInputToMinutes,
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

describe("addMinutesToTime", () => {
  it("addiert Minuten innerhalb eines Tages", () => {
    expect(addMinutesToTime("08:00", 30)).toBe("08:30");
    expect(addMinutesToTime("08:45", 30)).toBe("09:15");
  });

  it("rollt über Mitternacht", () => {
    expect(addMinutesToTime("23:30", 45)).toBe("00:15");
  });

  it("liefert null bei ungültiger Startzeit", () => {
    expect(addMinutesToTime("abc", 30)).toBeNull();
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
