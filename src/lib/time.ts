// Zeit-/Dauer-Helfer. Dauer wird intern in Minuten geführt.

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
