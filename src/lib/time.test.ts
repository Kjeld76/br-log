import { describe, expect, it } from "vitest";
import {
  computeDuration,
  durationFromRange,
  durationInputToMinutes,
  parseTimeToMinutes,
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
    });
  });

  it("liefert einen Fehler, wenn Von >= Bis ist (kein Mitternachts-Fallback)", () => {
    // Aktuelles, bewusst strenges Verhalten: anders als durationFromRange gibt es
    // hier KEINE +24h-Annahme, sondern einen Fehler.
    expect(computeDuration("10:00", "10:00")).toEqual({
      minutes: null,
      error: "Bis muss nach Von liegen.",
    });
    expect(computeDuration("22:00", "06:00")).toEqual({
      minutes: null,
      error: "Bis muss nach Von liegen.",
    });
  });

  it("liefert kein Ergebnis (weder Wert noch Fehler) bei unvollständiger Eingabe", () => {
    expect(computeDuration(null, "10:00")).toEqual({
      minutes: null,
      error: null,
    });
    expect(computeDuration("10:00", null)).toEqual({
      minutes: null,
      error: null,
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
