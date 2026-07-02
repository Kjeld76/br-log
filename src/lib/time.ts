// Zeit-/Dauer-Helfer. Dauer wird intern in Minuten geführt.

import { differenceInCalendarDays, parseISO } from "date-fns";

export function parseTimeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Dauer aus Von/Bis. Über Mitternacht wird als Folgetag interpretiert. */
export function durationFromRange(
  start: string | null,
  end: string | null
): number | null {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s === null || e === null) return null;
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return d;
}

export interface DurationResult {
  minutes: number | null; // null, solange Von/Bis unvollständig oder ungültig
  error: string | null; // gesetzt nur bei leerem Zeitraum (Von === Bis)
  overnight: boolean; // true, wenn Bis vor Von liegt -> als Folgetag gewertet
}

/**
 * Dauer aus Von/Bis. Bis < Von wird bewusst als Schicht über Mitternacht gewertet
 * (Folgetag, +24h) statt als Fehler – Nachtschichten sind bei BR-Zeiten Alltag.
 * Nur Bis === Von (Nullzeitraum) bleibt ein Fehler, da dort keine sinnvolle
 * Annahme möglich ist.
 */
export function computeDuration(
  start: string | null,
  end: string | null
): DurationResult {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s === null || e === null) return { minutes: null, error: null, overnight: false };
  if (e === s) {
    return { minutes: null, error: "Die Dauer muss größer als 0 sein.", overnight: false };
  }
  const overnight = e < s;
  return { minutes: durationFromRange(start, end), error: null, overnight };
}

/** Minuten -> "H:MM". */
export function minutesToHhmm(total: number): string {
  const sign = total < 0 ? "-" : "";
  const t = Math.abs(Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/** Minuten -> "H Std M Min" (gut lesbar). */
export function formatDurationLong(total: number): string {
  const t = Math.abs(Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m} Min`;
  if (m === 0) return `${h} Std`;
  return `${h} Std ${m} Min`;
}

/** Minuten -> Dezimalstunden (2 Nachkommastellen), z. B. für die Abrechnung. */
export function minutesToDecimalHours(total: number): number {
  return Math.round((total / 60) * 100) / 100;
}

/** Eingabe "H:MM" oder reine Minutenzahl -> Minuten. */
export function durationInputToMinutes(input: string): number | null {
  const v = input.trim();
  if (v === "") return null;
  if (v.includes(":")) {
    const m = /^(\d{1,3}):(\d{1,2})$/.exec(v);
    if (!m) return null;
    const min = Number(m[2]);
    if (min > 59) return null;
    return Number(m[1]) * 60 + min;
  }
  if (/^\d+$/.test(v)) return Number(v);
  return null;
}

/** HH:mm + Minuten (rollt über Mitternacht, Ergebnis bleibt 00:00-23:59). */
export function addMinutesToTime(hhmm: string, minutes: number): string | null {
  const base = parseTimeToMinutes(hhmm);
  if (base === null) return null;
  const dayLen = 24 * 60;
  const total = ((base + minutes) % dayLen + dayLen) % dayLen;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface DatedRange {
  date: string; // YYYY-MM-DD, Starttag
  start: string; // HH:mm
  end: string; // HH:mm (kann < start liegen -> über Mitternacht)
}

/**
 * Prüft, ob sich zwei datierte Zeiträume überschneiden (inkl. Über-Mitternacht,
 * siehe computeDuration/durationFromRange). Wird für die Überlappungswarnung
 * beim Speichern genutzt.
 */
export function rangesOverlap(a: DatedRange, b: DatedRange): boolean {
  const anchor = a.date < b.date ? a.date : b.date;
  const abs = (r: DatedRange) => {
    const s = parseTimeToMinutes(r.start);
    const e = parseTimeToMinutes(r.end);
    if (s === null || e === null) return null;
    const dayOffset = differenceInCalendarDays(parseISO(r.date), parseISO(anchor)) * 24 * 60;
    const start = dayOffset + s;
    let end = dayOffset + e;
    if (end <= start) end += 24 * 60;
    return { start, end };
  };
  const ra = abs(a);
  const rb = abs(b);
  if (!ra || !rb) return false;
  return ra.start < rb.end && rb.start < ra.end;
}
