import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addDays,
  addMonths,
  isSameMonth,
  parseISO,
} from "date-fns";
import { de } from "date-fns/locale";

export interface CalendarCell {
  date: Date;
  iso: string; // yyyy-MM-dd
  inMonth: boolean;
}

/** Monatsraster (Wochen Mo–So), inkl. Rand-Tage der Nachbarmonate. */
export function monthGrid(month: Date): CalendarCell[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((d) => ({
    date: d,
    iso: format(d, "yyyy-MM-dd"),
    inMonth: isSameMonth(d, month),
  }));
}

// Finding 28: ohne explizite Locale formatiert date-fns englisch ("July 2026"),
// während die Wochentage direkt darunter hart deutsch kodiert sind (WEEKDAYS) --
// sichtbarer Sprachbruch. Mit { locale: de } liefert MMMM den deutschen Monatsnamen.
export function monthLabel(month: Date): string {
  return format(month, "MMMM yyyy", { locale: de });
}

export function shiftMonth(month: Date, delta: number): Date {
  return addMonths(month, delta);
}

export function monthRangeIso(month: Date): { from: string; to: string } {
  return {
    from: format(startOfMonth(month), "yyyy-MM-dd"),
    to: format(endOfMonth(month), "yyyy-MM-dd"),
  };
}

/** Wochenbereich (Mo–So) des übergebenen Datums, für die Wochensumme (Finding 25). */
export function weekRangeIso(date: Date): { from: string; to: string } {
  return {
    from: format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    to: format(endOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
  };
}

/**
 * ISO-Datum (yyyy-MM-dd) -> deutsches Kurzformat, z. B. "Do., 02.07.2026"
 * (Finding 28: EntryList/EntryDetail/CalendarView zeigten bisher das rohe
 * ISO-Format). Ungültige Eingaben werden unverändert zurückgegeben, statt
 * "Invalid Date" anzuzeigen.
 */
export function formatDateDe(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "EEE, dd.MM.yyyy", { locale: de });
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Heutiges Datum als YYYY-MM-DD. EINZIGE Implementierung -- war zuvor
 * wortgleich dreifach kopiert: todayIso() in App.tsx, todayIso() in
 * QuickEntryView.tsx und stamp() in exporters.ts (Finding 45).
 */
export function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * ISO-Datum ± n Kalendertage. EINZIGE Implementierung -- die Zeile
 * format(addDays(parseISO(iso), n)) war zuvor sechsfach im Termin-Code
 * verstreut (Muster von todayIso, Finding 45).
 */
export function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), "yyyy-MM-dd");
}
