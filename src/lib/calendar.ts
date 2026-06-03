import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  isSameMonth,
} from "date-fns";

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

export function monthLabel(month: Date): string {
  return format(month, "MMMM yyyy");
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

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
