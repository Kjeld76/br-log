// Erinnerungs-Logik des Terminkalenders (reine Funktionen, Vitest-testbar).
//
// Architektur (siehe Plan): Auf dem Desktop gibt es KEIN System-Scheduling
// (tauri-plugin-notification kann dort nur sofortige Notifications) -- App.tsx
// hält deshalb einen In-Memory-SNAPSHOT der nächsten Erinnerungs-Kandidaten
// und prüft ihn in einem Intervall. Der Snapshot besteht aus AppointmentListItem-
// Daten (Titel/Zeit), trägt also strukturell nie das BR-Geheimnis -- wichtig,
// weil er auch bei GESPERRTER Datenbank weiterlebt (Auto-Lock beim Verstecken
// ins Tray) und dann aus dem Speicher feuert. Feuer-Markierungen, die bei
// gesperrter DB anfallen, sammelt App.tsx in einem Pending-Set und schreibt
// sie nach dem Entsperren (reminder_fired verhindert Doppel-Feuern dauerhaft).

import type { AppointmentListItem, ReminderFired } from "../types";
import { expandOccurrences } from "./appointments";

/**
 * Basis-Uhrzeit ganztägiger Termine für die Vorlauf-Berechnung ("1 Tag
 * vorher" bei einem ganztägigen Termin soll nicht um Mitternacht feuern).
 */
export const ALL_DAY_REMINDER_BASE = "09:00";

/** Wie lange eine fällige Erinnerung noch "live" gefeuert wird (nicht als verpasst gilt). */
export const LIVE_WINDOW_MS = 90_000;

/** Nachhol-Fenster beim Start/Entsperren. */
export const MISSED_LOOKBACK_DAYS = 7;

/** Ein konkreter Feuer-Kandidat: (Termin-Instanz × Erinnerung). */
export interface ReminderCandidate {
  /** Master- bzw. Einzeltermin-ID -- die Zeile, die die Erinnerung TRÄGT. */
  appointmentId: string;
  reminderId: string;
  /** YYYY-MM-DD-Anker der Instanz (reminder_fired-Schlüsselteil). */
  anchor: string;
  /** Fälligkeitszeitpunkt in Epoch-Millisekunden (lokale Wandzeit). */
  dueMs: number;
  title: string;
  isImportant: boolean;
  /** Anzeige: wann der Termin selbst beginnt. */
  occStartDate: string;
  occStartTime: string | null;
}

export function firedKey(k: {
  appointmentId: string;
  reminderId: string;
  anchor: string;
}): string {
  return `${k.appointmentId}|${k.reminderId}|${k.anchor}`;
}

export function firedKeySetFrom(rows: ReminderFired[]): Set<string> {
  return new Set(
    rows.map((r) =>
      firedKey({
        appointmentId: r.appointmentId,
        reminderId: r.reminderId,
        anchor: r.occurrenceAnchor,
      })
    )
  );
}

/** Lokale Wandzeit (Datum + HH:mm) -> Epoch-Millisekunden. */
function localMs(dateIso: string, time: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * Baut die Erinnerungs-Kandidaten aller Termin-Instanzen im Fenster [from, to].
 * Overrides erben die Erinnerungen ihres Masters (die Override-Zeile trägt
 * keine eigenen); Fälligkeit = Instanz-Beginn minus Vorlauf, bei ganztägigen
 * Terminen relativ zu ALL_DAY_REMINDER_BASE.
 */
export function buildReminderCandidates(
  items: AppointmentListItem[],
  from: string,
  to: string
): ReminderCandidate[] {
  const byId = new Map(items.map((a) => [a.id, a]));
  const out: ReminderCandidate[] = [];
  for (const occ of expandOccurrences(items, from, to)) {
    const a = occ.appointment;
    const master = a.parentId ? byId.get(a.parentId) : a;
    if (!master || master.reminders.length === 0) continue;
    const baseTime = a.isAllDay
      ? ALL_DAY_REMINDER_BASE
      : occ.startTime ?? ALL_DAY_REMINDER_BASE;
    const baseMs = localMs(occ.startDate, baseTime);
    for (const r of master.reminders) {
      out.push({
        appointmentId: master.id,
        reminderId: r.id,
        anchor: occ.anchor,
        dueMs: baseMs - r.minutesBefore * 60_000,
        title: a.title || "(ohne Titel)",
        isImportant: a.isImportant,
        occStartDate: occ.startDate,
        occStartTime: a.isAllDay ? null : occ.startTime,
      });
    }
  }
  return out.sort((x, y) => x.dueMs - y.dueMs);
}

/**
 * Jetzt fällige, noch nicht gefeuerte Kandidaten: dueMs in
 * (nowMs - maxAgeMs, nowMs]. Ältere gelten als "verpasst" (Nachhol-Banner).
 */
export function selectDue(
  candidates: ReminderCandidate[],
  firedKeys: Set<string>,
  nowMs: number,
  maxAgeMs: number = LIVE_WINDOW_MS
): ReminderCandidate[] {
  return candidates.filter(
    (c) =>
      c.dueMs <= nowMs &&
      c.dueMs > nowMs - maxAgeMs &&
      !firedKeys.has(firedKey(c))
  );
}

/**
 * Verpasste Erinnerungen beim Start/Entsperren: fällig vor dem Live-Fenster,
 * innerhalb des Nachhol-Zeitraums, noch nicht gefeuert.
 */
export function selectMissed(
  candidates: ReminderCandidate[],
  firedKeys: Set<string>,
  nowMs: number,
  lookbackDays: number = MISSED_LOOKBACK_DAYS
): ReminderCandidate[] {
  const oldest = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  return candidates.filter(
    (c) =>
      c.dueMs <= nowMs - LIVE_WINDOW_MS &&
      c.dueMs >= oldest &&
      !firedKeys.has(firedKey(c))
  );
}

/** Notification-Text einer Erinnerung, z. B. "Heute 14:00 · Raum 1". */
export function reminderBody(c: ReminderCandidate, todayIso: string): string {
  const dayLabel =
    c.occStartDate === todayIso ? "Heute" : c.occStartDate.split("-").reverse().join(".");
  return c.occStartTime ? `${dayLabel} ${c.occStartTime} Uhr` : `${dayLabel} (ganztägig)`;
}
