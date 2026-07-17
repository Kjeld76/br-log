// Reine Termin-Logik (DB-frei, Vitest-testbar): Expansion von Terminen in ein
// Anzeigefenster, Tages-Zuordnung und Sortierung. Alles in lokaler Wandzeit
// (YYYY-MM-DD / HH:mm-Strings), wie app-weit üblich.

import type { AppointmentListItem } from "../types";

/**
 * Eine konkrete Termin-Instanz im Anzeigefenster. Bei Einzelterminen 1:1 der
 * Termin selbst; bei Serien (ab der Serien-Expansion) eine generierte Instanz
 * bzw. deren Override-Zeile.
 */
export interface Occurrence {
  /** Die darzustellende Zeile (Override-Zeile, falls die Instanz bearbeitet wurde). */
  appointment: AppointmentListItem;
  /** YYYY-MM-DD-Anker der Instanz (Einzeltermin: startDate). */
  anchor: string;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
}

/** Überlappt [startDate, endDate] (inklusiv) das Fenster [from, to]? */
export function overlapsRange(
  startDate: string,
  endDate: string,
  from: string,
  to: string
): boolean {
  return startDate <= to && endDate >= from;
}

/**
 * Expandiert die geladenen Termine in konkrete Instanzen des Fensters
 * [from, to]. Einzeltermine (rrule = null, kein Override) liefern genau eine
 * Instanz, wenn sie das Fenster überlappen. Serien-Master und Overrides
 * werden von der Serien-Expansion behandelt (expandiert die RRULE, filtert
 * exdates, ersetzt Instanzen durch ihre Overrides).
 */
export function expandOccurrences(
  items: AppointmentListItem[],
  from: string,
  to: string
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const a of items) {
    if (a.parentId !== null) continue; // Overrides gehören zu ihrer Serie
    if (a.rrule === null) {
      if (overlapsRange(a.startDate, a.endDate, from, to)) {
        out.push({
          appointment: a,
          anchor: a.startDate,
          startDate: a.startDate,
          startTime: a.startTime,
          endDate: a.endDate,
          endTime: a.endTime,
        });
      }
      continue;
    }
    // Serien-Master: RRULE-Expansion (folgt mit der Serien-Unterstützung).
  }
  return sortOccurrences(out);
}

/** Instanzen, die den übergebenen Tag berühren (mehrtägige an jedem Tag). */
export function occurrencesOnDay(occs: Occurrence[], iso: string): Occurrence[] {
  return occs.filter((o) => o.startDate <= iso && o.endDate >= iso);
}

/**
 * Sortierung für Kalender/Agenda: nach Startdatum, ganztägige zuerst (sie
 * rahmen den Tag), dann nach Startzeit, zuletzt stabil nach Titel.
 */
export function sortOccurrences(occs: Occurrence[]): Occurrence[] {
  return [...occs].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    const aAllDay = a.appointment.isAllDay ? 0 : 1;
    const bAllDay = b.appointment.isAllDay ? 0 : 1;
    if (aAllDay !== bAllDay) return aAllDay - bAllDay;
    const at = a.startTime ?? "";
    const bt = b.startTime ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.appointment.title.localeCompare(b.appointment.title, "de");
  });
}

/** Anzeige der Zeitspanne einer Instanz, z. B. "09:00–11:00" oder "Ganztägig". */
export function formatOccurrenceTime(o: Occurrence): string {
  if (o.appointment.isAllDay) return "Ganztägig";
  if (!o.startTime || !o.endTime) return "";
  return `${o.startTime}–${o.endTime}`;
}

/** Ist die Instanz am übergebenen Tag mehrtägig fortgesetzt (nicht ihr erster Tag)? */
export function continuesFromPreviousDay(o: Occurrence, iso: string): boolean {
  return o.startDate < iso;
}

/** Läuft die Instanz über den übergebenen Tag hinaus weiter? */
export function continuesToNextDay(o: Occurrence, iso: string): boolean {
  return o.endDate > iso;
}
