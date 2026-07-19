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
import { expandOccurrences, resolveOverride } from "./appointments";

/**
 * Basis-Uhrzeit ganztägiger Termine für die Vorlauf-Berechnung ("1 Tag
 * vorher" bei einem ganztägigen Termin soll nicht um Mitternacht feuern).
 */
export const ALL_DAY_REMINDER_BASE = "09:00";

/** Wie lange eine fällige Erinnerung noch "live" gefeuert wird (nicht als verpasst gilt). */
export const LIVE_WINDOW_MS = 90_000;

/** Nachhol-Fenster beim Start/Entsperren. */
export const MISSED_LOOKBACK_DAYS = 7;

/**
 * Vorausschau des Kandidaten-Snapshots. Muss großzügig sein: Im Tray-/Sperr-
 * Betrieb feuert der 30-s-Loop NUR aus diesem Snapshot (die DB ist zu) --
 * der Horizont bestimmt also, wie lange die App ohne Entsperren zuverlässig
 * erinnert. Außerdem braucht "1 Woche vorher" Kandidaten für Termine, die
 * deutlich hinter dem alten 8-Tage-Fenster lagen.
 */
export const REMINDER_HORIZON_DAYS = 60;

/**
 * Maximales Alter des Kandidaten-Snapshots, bevor der 30-s-Loop bei
 * entsperrter App einen Neuaufbau anstößt, damit das Fenster im
 * Dauerbetrieb mitrollt (ohne reloadKey-Bump veraltete es sonst unbegrenzt).
 */
export const SNAPSHOT_MAX_AGE_MS = 12 * 3600_000;

/**
 * Titel + Text einer Termin-Notification -- EINE Quelle für die Desktop-
 * Sofort-Anzeige und die Android-System-Planung, damit derselbe Termin auf
 * beiden Wegen identisch aussieht.
 */
export function notificationContent(
  c: ReminderCandidate,
  todayIso: string
): { title: string; body: string } {
  return {
    title: (c.isImportant ? "Wichtiger Termin: " : "Termin: ") + c.title,
    body: reminderBody(c, todayIso),
  };
}

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

/**
 * Fälligkeit = Instanz-Beginn minus Vorlauf. Der TAGES-Anteil des Vorlaufs
 * wird in Kalendertagen abgezogen ("1 Tag vorher" heißt gleiche Wanduhrzeit
 * am Vortag -- ein fester 24-h-Offset verschöbe die Erinnerung über
 * DST-Grenzen um eine Stunde); nur der Rest unter einem Tag läuft als
 * Minuten-Offset. Der Date-Konstruktor normalisiert d - days kalendarisch.
 */
function dueMsFor(dateIso: string, time: string, minutesBefore: number): number {
  const days = Math.floor(minutesBefore / 1440);
  const restMin = minutesBefore % 1440;
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return (
    new Date(y, m - 1, d - days, hh, mm, 0, 0).getTime() - restMin * 60_000
  );
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
    const resolved = resolveOverride(a, a.parentId ? byId.get(a.parentId) : a);
    if (resolved.reminders.length === 0) continue;
    const baseTime = a.isAllDay
      ? ALL_DAY_REMINDER_BASE
      : occ.startTime ?? ALL_DAY_REMINDER_BASE;
    for (const r of resolved.reminders) {
      out.push({
        appointmentId: a.parentId ?? a.id,
        reminderId: r.id,
        anchor: occ.anchor,
        dueMs: dueMsFor(occ.startDate, baseTime, r.minutesBefore),
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

// ---------- Android: geplante System-Notifications (Rolling Window) ----------
//
// Auf Android plant App.tsx die nächsten Erinnerungen als ECHTE System-
// Notifications (Schedule.at) -- sie feuern auch bei geschlossener App. Bei
// jedem Start/Reload wird neu geplant (alte Planungen storniert); ein Reboot
// löscht AlarmManager-Planungen, das Nachhol-Banner ist das Sicherheitsnetz.
// Die localStorage-Liste der geplanten Schlüssel verhindert Doppel-Zustellung
// (In-App-Loop überspringt system-geplante Kandidaten) und lässt beim
// nächsten Start vergangene system-geplante als "zugestellt" gelten.

/** Maximal parallel geplante System-Notifications (Rolling Window). */
export const ANDROID_SCHEDULE_LIMIT = 32;

const SCHEDULED_KEY = "brlog.androidScheduled";

export interface ScheduledRef {
  key: string; // firedKey des Kandidaten
  id: number; // numerische Notification-ID (für cancel())
}

/** Stabile i32-Notification-ID aus dem Feuer-Schlüssel (String-Hash). */
export function notificationIdFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return h;
}

export function loadScheduledRefs(): ScheduledRef[] {
  try {
    const raw = localStorage.getItem(SCHEDULED_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is ScheduledRef =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as ScheduledRef).key === "string" &&
        typeof (x as ScheduledRef).id === "number"
    );
  } catch {
    return [];
  }
}

export function saveScheduledRefs(refs: ScheduledRef[]): void {
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(refs));
  } catch {
    // Nur Komfort (Doppel-Zustellungs-Schutz) -- kein Pflichtpfad.
  }
}

/** Zukünftige, ungefeuerte Kandidaten fürs Rolling Window (chronologisch). */
export function selectToSchedule(
  candidates: ReminderCandidate[],
  firedKeys: Set<string>,
  nowMs: number,
  limit: number = ANDROID_SCHEDULE_LIMIT
): ReminderCandidate[] {
  return candidates
    .filter((c) => c.dueMs > nowMs && !firedKeys.has(firedKey(c)))
    .slice(0, limit);
}
