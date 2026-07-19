// Reine Termin-Logik (DB-frei, Vitest-testbar): Expansion von Terminen in ein
// Anzeigefenster (inkl. RRULE-Serien via ical.js), Tages-Zuordnung, Sortierung
// und Serienregel-Helfer. Alles in lokaler Wandzeit (YYYY-MM-DD / HH:mm-
// Strings), wie app-weit üblich -- ical.js iteriert mit floating ICAL.Time
// (localTimezone), also kalendarisch korrekt über DST-Grenzen hinweg.

import ICAL from "ical.js";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { addDaysIso } from "./calendar";
import type {
  Appointment,
  AppointmentFullItem,
  AppointmentListItem,
  AppointmentReminder,
} from "../types";

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
 * Sicherung gegen kaputte/entartete (z. B. importierte) Serienregeln. Muss
 * großzügig sein, weil immer ab DTSTART iteriert wird (COUNT-Semantik und
 * Intervall-Phase erlauben keinen späteren Einstieg): FREQ=HOURLY erreicht
 * damit Fenster ~11 Jahre nach Serienstart, MINUTELY ~70 Tage.
 */
const MAX_ITERATIONS = 100_000;

function isoFromIcalTime(t: ICAL.Time): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(t.year, 4)}-${p(t.month)}-${p(t.day)}`;
}

/** JS-Date (beliebige Zone) -> lokales Y-M-D über die lokalen Date-Getter. */
function localIsoFromJsDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** DTSTART der Serie als floating ICAL.Time (Datum + ggf. Startzeit). */
function icalDtstart(a: {
  startDate: string;
  startTime: string | null;
  isAllDay: boolean;
}): ICAL.Time {
  const [year, month, day] = a.startDate.split("-").map(Number);
  // localTimezone ist in ical.js die "floating"-Zone (keine Umrechnungen).
  if (a.isAllDay || !a.startTime) {
    return new ICAL.Time({ year, month, day, isDate: true }, ICAL.Timezone.localTimezone);
  }
  const [hour, minute] = a.startTime.split(":").map(Number);
  return new ICAL.Time(
    { year, month, day, hour, minute, second: 0, isDate: false },
    ICAL.Timezone.localTimezone
  );
}

/** Occurrence aus einer Override-Zeile (Instanz wurde einzeln bearbeitet). */
function occurrenceFromOverride(ov: AppointmentListItem): Occurrence {
  return {
    appointment: ov,
    anchor: ov.recurrenceAnchor ?? ov.startDate,
    startDate: ov.startDate,
    startTime: ov.startTime,
    endDate: ov.endDate,
    endTime: ov.endTime,
  };
}

/** Expandiert EINEN Serien-Master (inkl. Exdates/Overrides) ins Fenster. */
function expandSeries(
  master: AppointmentListItem,
  overrides: AppointmentListItem[],
  from: string,
  to: string
): Occurrence[] {
  const out: Occurrence[] = [];
  const ovByAnchor = new Map(
    overrides.map((o) => [o.recurrenceAnchor ?? o.startDate, o])
  );
  const consumed = new Set<string>();
  const exdates = new Set(master.exdates);
  const spanDays = differenceInCalendarDays(
    parseISO(master.endDate),
    parseISO(master.startDate)
  );

  // fromString wirft bei kaputten Regeln nicht zwingend -- oft scheitert erst
  // der Iterator. Deshalb umschließt der try/catch die GESAMTE Iteration.
  try {
    const recur = ICAL.Recur.fromString(master.rrule ?? "");
    // Datums-UNTIL gilt INKLUSIV bis Tagesende. Ohne Normalisierung würde bei
    // zeitgebundenen Serien die Instanz am UNTIL-Tag ausgeschlossen (Vergleich
    // 09:00 > 00:00) -- betrifft eigene Presets UND importierte Regeln.
    if (recur.until && recur.until.isDate) {
      recur.until = new ICAL.Time(
        {
          year: recur.until.year,
          month: recur.until.month,
          day: recur.until.day,
          hour: 23,
          minute: 59,
          second: 59,
          isDate: false,
        },
        ICAL.Timezone.localTimezone
      );
    }
    const iter = recur.iterator(icalDtstart(master));
    // Max. eine Instanz pro Tag je Serie (Anker-Granularität, s. Migration 3):
    // Regeln mit mehreren Instanzen am Tag (importiertes FREQ=HOURLY o. ä.)
    // werden auf die erste Tagesinstanz vereinfacht.
    const seenAnchors = new Set<string>();
    let iterations = 0;
    let next: ICAL.Time | null;
    while ((next = iter.next())) {
      if (++iterations > MAX_ITERATIONS) {
        // Nicht still verschwinden lassen: der Abbruch ist diagnostizierbar.
        console.warn(
          `Serien-Expansion nach ${MAX_ITERATIONS} Iterationen abgebrochen ` +
            `(Termin ${master.id}, Regel ${master.rrule ?? ""})`
        );
        break;
      }
      const anchor = isoFromIcalTime(next);
      if (anchor > to) break;
      if (seenAnchors.has(anchor)) continue;
      seenAnchors.add(anchor);
      const ov = ovByAnchor.get(anchor);
      if (ov) {
        // Override ersetzt die generierte Instanz -- auch wenn er selbst aus
        // dem Fenster hinausgeschoben wurde (dann erscheint er dort, nicht hier).
        consumed.add(anchor);
        if (overlapsRange(ov.startDate, ov.endDate, from, to)) {
          out.push(occurrenceFromOverride(ov));
        }
        continue;
      }
      if (exdates.has(anchor)) continue;
      const occEnd = spanDays > 0 ? addDaysIso(anchor, spanDays) : anchor;
      if (occEnd < from) continue;
      out.push({
        appointment: master,
        anchor,
        startDate: anchor,
        startTime: master.startTime,
        endDate: occEnd,
        endTime: master.endTime,
      });
    }
  } catch {
    // Nicht parsebare/iterierbare Regel: defensiv wenigstens den Start-Termin
    // zeigen, statt die Serie stillschweigend verschwinden zu lassen.
    if (
      out.length === 0 &&
      overlapsRange(master.startDate, master.endDate, from, to)
    ) {
      out.push({
        appointment: master,
        anchor: master.startDate,
        startDate: master.startDate,
        startTime: master.startTime,
        endDate: master.endDate,
        endTime: master.endTime,
      });
    }
  }

  // Overrides, deren Anker außerhalb des iterierten Bereichs liegt (z. B.
  // hinter `to`), aber deren EIGENE Daten ins Fenster verschoben wurden.
  for (const ov of overrides) {
    const anchor = ov.recurrenceAnchor ?? ov.startDate;
    if (consumed.has(anchor)) continue;
    if (overlapsRange(ov.startDate, ov.endDate, from, to)) {
      out.push(occurrenceFromOverride(ov));
    }
  }
  return out;
}

/**
 * Expandiert die geladenen Termine in konkrete Instanzen des Fensters
 * [from, to]. Einzeltermine (rrule = null, kein Override) liefern genau eine
 * Instanz, wenn sie das Fenster überlappen; Serien-Master werden per RRULE
 * expandiert (Exdates gefiltert, Instanzen durch ihre Overrides ersetzt).
 */
export function expandOccurrences(
  items: AppointmentListItem[],
  from: string,
  to: string
): Occurrence[] {
  const out: Occurrence[] = [];
  const overridesByParent = new Map<string, AppointmentListItem[]>();
  for (const a of items) {
    if (a.parentId !== null) {
      const arr = overridesByParent.get(a.parentId) || [];
      arr.push(a);
      overridesByParent.set(a.parentId, arr);
    }
  }
  for (const a of items) {
    if (a.parentId !== null) continue; // Overrides laufen über ihre Serie
    if (a.rrule === null) {
      // Auch ein Master OHNE Regel kann Override-Kinder haben (Serie wurde auf
      // "Nie" gestellt; ICS-Import mit verworfener RDATE-Regel). Sie müssen
      // sichtbar bleiben; ein Override am Master-Anker ersetzt den Master.
      const overrides = overridesByParent.get(a.id) || [];
      const replacesSelf = overrides.some(
        (o) => (o.recurrenceAnchor ?? o.startDate) === a.startDate
      );
      if (!replacesSelf && overlapsRange(a.startDate, a.endDate, from, to)) {
        out.push({
          appointment: a,
          anchor: a.startDate,
          startDate: a.startDate,
          startTime: a.startTime,
          endDate: a.endDate,
          endTime: a.endTime,
        });
      }
      for (const ov of overrides) {
        if (overlapsRange(ov.startDate, ov.endDate, from, to)) {
          out.push(occurrenceFromOverride(ov));
        }
      }
      continue;
    }
    out.push(...expandSeries(a, overridesByParent.get(a.id) || [], from, to));
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

// ---------- Serienregeln (RRULE-Presets des Formulars) ----------

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export type SeriesEnd =
  | { type: "never" }
  | { type: "count"; count: number }
  | { type: "until"; date: string }; // YYYY-MM-DD, inklusiv

/**
 * Die vom Formular abgedeckte Teilmenge von RRULE. Regeln außerhalb davon
 * (z. B. BYSETPOS aus einem ICS-Import) liefern parseRruleToPreset -> null
 * und laufen als "benutzerdefinierte Regel" unverändert durch.
 */
export interface SeriesPreset {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number; // >= 1
  byWeekdays: WeekdayCode[]; // nur WEEKLY; leer = Wochentag des Starttermins
  end: SeriesEnd;
}

export function buildRrule(p: SeriesPreset): string {
  const parts = [`FREQ=${p.freq}`];
  if (p.interval > 1) parts.push(`INTERVAL=${p.interval}`);
  if (p.freq === "WEEKLY" && p.byWeekdays.length > 0) {
    // In Kalender-Reihenfolge (Mo zuerst), unabhängig von der Klick-Reihenfolge.
    const ordered = WEEKDAY_CODES.filter((c) => p.byWeekdays.includes(c));
    parts.push(`BYDAY=${ordered.join(",")}`);
  }
  if (p.end.type === "count") parts.push(`COUNT=${p.end.count}`);
  if (p.end.type === "until") parts.push(`UNTIL=${p.end.date.replace(/-/g, "")}`);
  return parts.join(";");
}

/**
 * Rekonstruiert das Formular-Preset aus einem RRULE-String. `null`, wenn die
 * Regel Bestandteile außerhalb der Preset-Teilmenge nutzt -- das Formular
 * zeigt dann "Benutzerdefinierte Serienregel" und lässt sie unangetastet.
 */
export function parseRruleToPreset(rrule: string): SeriesPreset | null {
  const params = new Map<string, string>();
  for (const kv of rrule.split(";")) {
    if (!kv) continue;
    const eq = kv.indexOf("=");
    if (eq <= 0) return null;
    params.set(kv.slice(0, eq).toUpperCase(), kv.slice(eq + 1));
  }
  const freq = params.get("FREQ");
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  ) {
    return null;
  }
  // Nur die vom Formular abgebildeten Bestandteile (WKST ist wirkungsfrei für
  // unsere Presets und wird toleriert); alles andere -> benutzerdefiniert.
  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) return null;
  }
  const interval = params.has("INTERVAL") ? Number(params.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;

  let byWeekdays: WeekdayCode[] = [];
  if (params.has("BYDAY")) {
    if (freq !== "WEEKLY") return null; // BYDAY bei MONTHLY (z. B. 2MO) kann das Formular nicht
    const tokens = (params.get("BYDAY") ?? "").split(",");
    for (const t of tokens) {
      if (!(WEEKDAY_CODES as readonly string[]).includes(t)) return null; // Ordinale wie "2MO" -> custom
    }
    byWeekdays = tokens as WeekdayCode[];
  }

  if (params.has("COUNT") && params.has("UNTIL")) return null; // RFC-widrig -> custom
  let end: SeriesEnd = { type: "never" };
  if (params.has("COUNT")) {
    const count = Number(params.get("COUNT"));
    if (!Number.isInteger(count) || count < 1) return null;
    end = { type: "count", count };
  } else if (params.has("UNTIL")) {
    const raw = params.get("UNTIL") ?? "";
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw);
    if (!m) return null;
    let date = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[7]) {
      // UTC-UNTIL (Google/Outlook): erst in lokale Wandzeit umrechnen -- das
      // UTC-Datum kann vom lokalen Datum der letzten Instanz abweichen, ein
      // Re-Save über das Formular würde die Serie sonst einen Tag zu früh
      // kappen (buildRrule schreibt ein reines Datums-UNTIL zurück).
      const js = new Date(
        Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6] ?? "0")
        )
      );
      const p = (n: number) => String(n).padStart(2, "0");
      date = `${js.getFullYear()}-${p(js.getMonth() + 1)}-${p(js.getDate())}`;
    }
    end = { type: "until", date };
  }
  return { freq, interval, byWeekdays, end };
}

export interface SeriesEndInput {
  rrule: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, inklusiv
  startTime: string | null;
  isAllDay: boolean;
}

/**
 * Letzter Tag, den die Serie berühren kann (konservativ: zu spät ist unschön,
 * zu früh wäre ein Bug -- eine echte spätere Instanz dürfte dann nicht mehr
 * aus dieser Cache-Spalte (`series_end_date`, Migration s. Task 1) gefunden
 * werden). `null` heißt "endlos oder unbekannt": weder COUNT noch UNTIL,
 * eine kaputte/nicht parsebare Regel (ICAL.Recur.fromString wirft -- deckt
 * sich mit der defensiven Anzeige in expandSeries) oder wenn der
 * Iterations-Guard bei COUNT-Regeln greift.
 */
export function seriesEndDateFor(a: SeriesEndInput): string | null {
  if (a.rrule === null) return null;
  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(a.rrule);
  } catch {
    return null;
  }
  const spanDays = differenceInCalendarDays(parseISO(a.endDate), parseISO(a.startDate));

  if (recur.until) {
    // Wie in parseRruleToPreset: ein Zeit-UNTIL in UTC kann lokal auf einen
    // anderen Tag fallen als das UTC-Datum -- ein zu frühes Serienende ließe
    // die letzte Instanz aus dem Kalender verschwinden.
    const anchor = recur.until.isDate
      ? isoFromIcalTime(recur.until)
      : localIsoFromJsDate(recur.until.toJSDate());
    return addDaysIso(anchor, Math.max(0, spanDays));
  }

  if (recur.count != null) {
    const iter = recur.iterator(icalDtstart(a));
    let lastAnchor: string | null = null;
    let iterations = 0;
    let next: ICAL.Time | null;
    while ((next = iter.next())) {
      if (++iterations > MAX_ITERATIONS) return null; // konservativ: unbekannt statt geraten
      lastAnchor = isoFromIcalTime(next);
    }
    return lastAnchor === null ? null : addDaysIso(lastAnchor, spanDays);
  }

  return null; // weder COUNT noch UNTIL -- endlose Serie
}

/** Vortag des Ankers -- das inklusive UNTIL des alten Serienteils beim Split. */
export function splitUntilDate(anchor: string): string {
  return addDaysIso(anchor, -1);
}

/**
 * Setzt COUNT segmentbasiert in einer Serienregel (Muster rruleWithUntil) --
 * die einzige erlaubte RRULE-Chirurgie außerhalb der Preset-Funktionen.
 */
export function rruleWithCount(rrule: string, count: number): string {
  const parts = rrule.split(";").filter((p) => p && !/^COUNT=/i.test(p));
  parts.push(`COUNT=${count}`);
  return parts.join(";");
}

/**
 * Setzt UNTIL (inklusiv, Datum) in einer Serienregel und entfernt ein
 * eventuelles COUNT. String-basiert, damit auch benutzerdefinierte (nicht
 * preset-fähige) Regeln ihre übrigen Bestandteile behalten.
 */
export function rruleWithUntil(rrule: string, untilIso: string): string {
  const parts = rrule
    .split(";")
    .filter((p) => p && !/^(COUNT|UNTIL)=/i.test(p));
  parts.push(`UNTIL=${untilIso.replace(/-/g, "")}`);
  return parts.join(";");
}

/**
 * Verbleibendes COUNT für den neuen Serienteil beim "diesen und folgende"-
 * Split: Original-COUNT minus der Instanzen VOR dem Anker (Exdates zählen mit,
 * sie haben ihren Zähler-Platz verbraucht). `null`, wenn die Regel kein COUNT
 * hat (dann braucht der neue Teil auch keins).
 */
export function remainingCountFrom(
  master: AppointmentListItem,
  anchor: string
): number | null {
  if (!master.rrule || !/(^|;)COUNT=/i.test(master.rrule)) return null;
  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(master.rrule);
  } catch {
    return null;
  }
  const total = recur.count ?? 0;
  if (total <= 0) return null;
  const iter = recur.iterator(icalDtstart(master));
  let before = 0;
  let iterations = 0;
  let next: ICAL.Time | null;
  while ((next = iter.next())) {
    if (++iterations > MAX_ITERATIONS) break;
    if (isoFromIcalTime(next) >= anchor) break;
    before++;
  }
  return Math.max(1, total - before);
}

// ---------- Termin-Builder (Serien-Scope-Operationen, Duplizieren) ----------
// Pure Funktionen statt Closures in App.tsx: die heikelsten Serien-Invarianten
// (Override-Kopplung, COUNT-Restkontingent, Exdates-Partition am Anker,
// frische Erinnerungs-IDs, ICS-Identitäts-Reset) sind hier testbar und für
// künftige Features (Wochenansicht, Drag-Verschieben) wiederverwendbar.

/** Die konkret angezeigte Instanz (bei Serien ≠ Master-Startdaten). */
export type OccurrenceRef = Omit<Occurrence, "appointment">;

/** AppointmentFullItem -> Appointment (ohne das Anzeige-Feld tagLabels). */
export function plainAppointment(a: AppointmentFullItem): Appointment {
  const { tagLabels: _tagLabels, ...plain } = a;
  return plain;
}

/**
 * Overrides erben Schlagwörter und Erinnerungen vom Master (ihre eigene Zeile
 * trägt keine, s. Migration 3) -- DIE eine Stelle, die diese Regel auflöst.
 * Für Nicht-Overrides oder fehlenden Master: unverändert zurück.
 */
export function resolveOverride<
  T extends {
    parentId: string | null;
    tagIds: string[];
    reminders: AppointmentReminder[];
    tagLabels?: string[];
  }
>(item: T, master: T | null | undefined): T {
  if (item.parentId === null || !master) return item;
  return {
    ...item,
    tagIds: master.tagIds,
    reminders: master.reminders,
    ...(master.tagLabels !== undefined ? { tagLabels: master.tagLabels } : {}),
  };
}

/** Entwurf einer Serien-Ausnahme ("nur dieser") aus der Master-Instanz. */
export function buildOverrideDraft(
  master: AppointmentFullItem,
  occ: OccurrenceRef
): Appointment {
  const now = new Date().toISOString();
  return {
    ...plainAppointment(master),
    id: crypto.randomUUID(),
    startDate: occ.startDate,
    startTime: occ.startTime,
    endDate: occ.endDate,
    endTime: occ.endTime,
    rrule: null,
    exdates: [],
    parentId: master.id,
    recurrenceAnchor: occ.anchor,
    icsUid: null,
    icsSequence: 0,
    // Overrides erben Schlagwörter/Erinnerungen -- eigene Zeile trägt keine.
    tagIds: [],
    reminders: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Entwurf der NEUEN Serie ab dem Anker ("dieser und folgende"). */
export function buildSplitDraft(
  master: AppointmentFullItem,
  occ: OccurrenceRef
): Appointment {
  const now = new Date().toISOString();
  const spanDays = differenceInCalendarDays(
    parseISO(master.endDate),
    parseISO(master.startDate)
  );
  // Bei COUNT-Regeln bekommt der neue Teil das RESTLICHE Kontingent --
  // sonst würde die Gesamtzahl der Termine durch den Split wachsen.
  let rrule = master.rrule;
  if (rrule) {
    const remaining = remainingCountFrom(master, occ.anchor);
    if (remaining !== null) rrule = rruleWithCount(rrule, remaining);
  }
  return {
    ...plainAppointment(master),
    id: crypto.randomUUID(),
    startDate: occ.anchor,
    endDate: addDaysIso(occ.anchor, spanDays),
    rrule,
    exdates: master.exdates.filter((d) => d >= occ.anchor),
    icsUid: null,
    icsSequence: 0,
    // Frische IDs: appointment_reminders.id ist global eindeutig.
    reminders: master.reminders.map((r) => ({
      id: crypto.randomUUID(),
      minutesBefore: r.minutesBefore,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

/** Master mit UNTIL = Vortag des Ankers (alter Serienteil bei Split/Kürzen). */
export function truncatedMaster(
  master: AppointmentFullItem,
  anchor: string
): Appointment {
  return {
    ...plainAppointment(master),
    rrule: master.rrule
      ? rruleWithUntil(master.rrule, splitUntilDate(anchor))
      : master.rrule,
    exdates: master.exdates.filter((d) => d < anchor),
  };
}

/**
 * Übernimmt einen Termin als Vorlage: frische ID, `today` als Startdatum unter
 * Erhalt der Dauer in Tagen, NEUE Erinnerungs-IDs und ohne ICS-Identität
 * (UID/SEQUENCE gehören zum Original).
 */
export function duplicateAppointment(
  source: AppointmentFullItem,
  today: string
): Appointment {
  const now = new Date().toISOString();
  const spanDays = differenceInCalendarDays(
    parseISO(source.endDate),
    parseISO(source.startDate)
  );
  return {
    ...plainAppointment(source),
    id: crypto.randomUUID(),
    startDate: today,
    endDate: addDaysIso(today, spanDays),
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceAnchor: null,
    icsUid: null,
    icsSequence: 0,
    reminders: source.reminders.map((r) => ({
      id: crypto.randomUUID(),
      minutesBefore: r.minutesBefore,
    })),
    createdAt: now,
    updatedAt: now,
  };
}
