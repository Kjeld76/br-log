// ICS-Import/-Export (RFC 5545) für den Terminkalender, komplett über ical.js
// (parst, serialisiert, faltet Zeilen und escapet Sonderzeichen).
//
// Zeit-Strategie (siehe Plan): Die App rechnet in lokaler Wandzeit ohne
// Zeitzonen. Export schreibt deshalb FLOATING-Zeiten (DTSTART ohne TZID) bzw.
// VALUE=DATE für ganztägig; Import rechnet TZID-/UTC-Zeiten über die
// registrierten VTIMEZONEs in lokale Wandzeit um. DTEND ist in ICS EXKLUSIV --
// die Konvertierung von/zu unserem inklusiven end_date passiert AUSSCHLIESSLICH
// hier (Export: +1 Tag bei ganztägig; Import: -1 Tag).

import ICAL from "ical.js";
import { addDays, format, parseISO } from "date-fns";
import type { Appointment, AppointmentFullItem } from "../types";

/** Eigene X-Property für das BR-Geheimnis (nur bei explizitem Vertraulich-Export). */
const SECRET_PROP = "x-brlog-secret";

// ---------- Export ----------

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function icalDate(iso: string): ICAL.Time {
  const [year, month, day] = iso.split("-").map(Number);
  return new ICAL.Time({ year, month, day, isDate: true }, ICAL.Timezone.localTimezone);
}

function icalDateTime(iso: string, time: string): ICAL.Time {
  const [year, month, day] = iso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new ICAL.Time(
    { year, month, day, hour, minute, second: 0, isDate: false },
    ICAL.Timezone.localTimezone
  );
}

/** UID für den Export: gespeicherte Import-UID oder stabile eigene. */
function exportUid(a: AppointmentFullItem): string {
  return a.icsUid ?? `${a.id}@br-log.local`;
}

/**
 * Datums-UNTIL (8-stellig) bei zeitgebundenen Serien auf Tagesende anheben:
 * RFC verlangt bei DATE-TIME-DTSTART ein DATE-TIME-UNTIL, und Fremdkalender
 * würden den letzten Serientag sonst ausschließen (unser UNTIL ist inklusiv).
 */
function rruleForExport(rrule: string, isAllDay: boolean): string {
  if (isAllDay) return rrule;
  return rrule.replace(/UNTIL=(\d{8})(?=;|$)/, "UNTIL=$1T235959");
}

function addVevent(
  vcalendar: ICAL.Component,
  a: AppointmentFullItem,
  master: AppointmentFullItem | null,
  includeConfidential: boolean,
  dtstamp: ICAL.Time
): void {
  const vevent = new ICAL.Component("vevent");
  vcalendar.addSubcomponent(vevent);

  // Overrides tragen die UID ihres Masters + RECURRENCE-ID (RFC-Modell).
  vevent.updatePropertyWithValue("uid", master ? exportUid(master) : exportUid(a));
  vevent.updatePropertyWithValue("dtstamp", dtstamp);
  vevent.updatePropertyWithValue("summary", a.title);
  if (a.location) vevent.updatePropertyWithValue("location", a.location);
  if (a.description) vevent.updatePropertyWithValue("description", a.description);
  if (includeConfidential && a.secretDetails) {
    vevent.updatePropertyWithValue(SECRET_PROP, a.secretDetails);
  }

  if (a.isAllDay) {
    vevent.updatePropertyWithValue("dtstart", icalDate(a.startDate));
    // DTEND exklusiv: inklusives end_date + 1 Tag.
    vevent.updatePropertyWithValue(
      "dtend",
      icalDate(format(addDays(parseISO(a.endDate), 1), "yyyy-MM-dd"))
    );
  } else {
    vevent.updatePropertyWithValue(
      "dtstart",
      icalDateTime(a.startDate, a.startTime ?? "00:00")
    );
    vevent.updatePropertyWithValue(
      "dtend",
      icalDateTime(a.endDate, a.endTime ?? "23:59")
    );
  }

  if (master) {
    // Original-Startzeitpunkt der überschriebenen Instanz (Anker + Master-Zeit).
    const anchor = a.recurrenceAnchor ?? a.startDate;
    vevent.updatePropertyWithValue(
      "recurrence-id",
      master.isAllDay
        ? icalDate(anchor)
        : icalDateTime(anchor, master.startTime ?? "00:00")
    );
  }

  if (a.rrule) {
    try {
      vevent.updatePropertyWithValue(
        "rrule",
        ICAL.Recur.fromString(rruleForExport(a.rrule, a.isAllDay))
      );
    } catch {
      // Kaputte gespeicherte Regel: Termin ohne Serie exportieren statt die
      // ganze Datei unbrauchbar zu machen.
    }
    for (const ex of a.exdates) {
      const prop = new ICAL.Property("exdate", vevent);
      prop.setValue(
        a.isAllDay ? icalDate(ex) : icalDateTime(ex, a.startTime ?? "00:00")
      );
      vevent.addProperty(prop);
    }
  }

  if (a.isImportant) vevent.updatePropertyWithValue("priority", 1);
  if (a.icsSequence > 0) vevent.updatePropertyWithValue("sequence", a.icsSequence);
  if (a.tagLabels.length > 0) {
    const cats = new ICAL.Property("categories", vevent);
    cats.setValues(a.tagLabels);
    vevent.addProperty(cats);
  }

  // Erinnerungen als VALARM (relativer Trigger vor dem Start). Overrides
  // erben sie vom Master -- dessen VEVENT trägt die VALARMs bereits.
  for (const r of a.reminders) {
    const alarm = new ICAL.Component("valarm");
    alarm.updatePropertyWithValue("action", "DISPLAY");
    alarm.updatePropertyWithValue("description", "Erinnerung");
    alarm.updatePropertyWithValue(
      "trigger",
      ICAL.Duration.fromSeconds(-r.minutesBefore * 60)
    );
    vevent.addSubcomponent(alarm);
  }
}

/**
 * Serialisiert die übergebenen Termine (Master/Einzeltermine + Overrides) als
 * iCalendar-Text. Vertrauliche Notizen NUR bei explizitem includeConfidential
 * (eigene X-Property, Standard: außen vor).
 */
export function buildIcs(
  items: AppointmentFullItem[],
  opts: { includeConfidential: boolean }
): string {
  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.updatePropertyWithValue("prodid", "-//BR-Log//Terminkalender//DE");
  vcalendar.updatePropertyWithValue("version", "2.0");
  vcalendar.updatePropertyWithValue("calscale", "GREGORIAN");

  const byId = new Map(items.map((a) => [a.id, a]));
  const dtstamp = ICAL.Time.fromJSDate(new Date(), true);
  // Master/Einzeltermine zuerst, dann Overrides (Lesbarkeit + stabile Ordnung).
  const sorted = [...items].sort(
    (x, y) => Number(x.parentId !== null) - Number(y.parentId !== null)
  );
  for (const a of sorted) {
    const master = a.parentId ? byId.get(a.parentId) ?? null : null;
    if (a.parentId && !master) continue; // Override ohne Master: nicht exportierbar
    addVevent(vcalendar, a, master, opts.includeConfidential, dtstamp);
  }
  return vcalendar.toString();
}

// ---------- Import ----------

/** Ein importierter Termin + seine CATEGORIES-Labels (Tag-Zuordnung macht die UI). */
export interface IcsImportItem {
  appointment: Appointment;
  categories: string[];
}

export interface IcsParseResult {
  items: IcsImportItem[];
  warnings: string[];
}

/** ICAL.Time -> lokale Wandzeit (registrierte TZID/UTC werden umgerechnet). */
function toLocalParts(t: ICAL.Time): { date: string; time: string } {
  const js = t.toJSDate();
  return {
    date: `${js.getFullYear()}-${pad(js.getMonth() + 1)}-${pad(js.getDate())}`,
    time: `${pad(js.getHours())}:${pad(js.getMinutes())}`,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

function valarmMinutes(vevent: ICAL.Component, warnings: string[]): number[] {
  const minutes = new Set<number>();
  for (const alarm of vevent.getAllSubcomponents("valarm")) {
    const trigger: unknown = alarm.getFirstPropertyValue("trigger");
    if (trigger instanceof ICAL.Duration) {
      const secs = trigger.toSeconds();
      // Relativer Trigger VOR dem Start (negativ); positive (nach dem Start)
      // kennt unser Modell nicht -> als "zum Termin" übernehmen.
      minutes.add(secs <= 0 ? Math.round(-secs / 60) : 0);
    } else if (trigger) {
      warnings.push(
        "Eine Erinnerung mit absolutem Zeitpunkt wurde übersprungen (nicht unterstützt)."
      );
    }
  }
  return [...minutes].sort((a, b) => a - b);
}

function parsePriority(vevent: ICAL.Component): boolean {
  const p = vevent.getFirstPropertyValue("priority");
  return typeof p === "number" && p >= 1 && p <= 4;
}

function parseCategories(vevent: ICAL.Component): string[] {
  const out: string[] = [];
  for (const prop of vevent.getAllProperties("categories")) {
    for (const v of prop.getValues()) {
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
  }
  return out;
}

function parseExdates(vevent: ICAL.Component): string[] {
  const out = new Set<string>();
  for (const prop of vevent.getAllProperties("exdate")) {
    for (const v of prop.getValues()) {
      if (v instanceof ICAL.Time) out.add(toLocalParts(v).date);
    }
  }
  return [...out].sort();
}

/**
 * Parst eine ICS-Datei zu importierbaren Terminen. Tolerant: nicht
 * unterstützbare Konstrukte werden vereinfacht/übersprungen und als deutsche
 * Hinweise gemeldet, statt den Import scheitern zu lassen.
 */
export function parseIcs(text: string): IcsParseResult {
  const warnings: string[] = [];
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error(
      "Ungültige ICS-Datei: Der Inhalt ist kein lesbares iCalendar-Format."
    );
  }

  // VTIMEZONEs registrieren, damit TZID-Zeiten (Google/Outlook) korrekt in
  // lokale Wandzeit umgerechnet werden. Unbekannte TZIDs behandelt ical.js
  // als floating -- tolerierte Näherung.
  for (const tzComp of root.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(tzComp);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz);
      }
    } catch {
      warnings.push("Eine Zeitzonen-Definition der Datei konnte nicht gelesen werden.");
    }
  }

  interface RawEvent {
    vevent: ICAL.Component;
    event: ICAL.Event;
    uid: string | null;
    isOverride: boolean;
  }
  const raws: RawEvent[] = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    if (!vevent.getFirstProperty("dtstart")) {
      warnings.push("Ein Termin ohne Startzeitpunkt wurde übersprungen.");
      continue;
    }
    const uidRaw = vevent.getFirstPropertyValue("uid");
    raws.push({
      vevent,
      event,
      uid: typeof uidRaw === "string" && uidRaw ? uidRaw : null,
      isOverride: vevent.getFirstProperty("recurrence-id") !== null,
    });
  }

  const now = new Date().toISOString();
  const masterIdByUid = new Map<string, string>();
  const masterByUid = new Map<string, RawEvent>();
  const items: IcsImportItem[] = [];

  const buildBase = (raw: RawEvent): Appointment => {
    const { vevent, event } = raw;
    const isAllDay = event.startDate.isDate;
    const start = toLocalParts(event.startDate);
    // event.endDate deckt DTEND, DURATION und fehlende Angaben (=> Start) ab.
    const end = toLocalParts(event.endDate);
    let endDate = end.date;
    if (isAllDay) {
      // DTEND exklusiv -> inklusives Enddatum. Bei fehlendem/gleichem DTEND
      // (endDate == startDate) bleibt der Ein-Tages-Termin bestehen.
      if (endDate > start.date) {
        endDate = format(addDays(parseISO(endDate), -1), "yyyy-MM-dd");
      }
      if (endDate < start.date) endDate = start.date;
    } else if (endDate < start.date) {
      endDate = start.date; // defensiv gegen kaputte Dateien
    }

    let rrule: string | null = null;
    const rruleValue = vevent.getFirstPropertyValue("rrule");
    if (rruleValue instanceof ICAL.Recur) rrule = rruleValue.toString();
    if (vevent.getFirstProperty("rdate")) {
      warnings.push(
        `„${event.summary ?? "(ohne Titel)"}“: Zusätzliche Einzeltermine der Serie (RDATE) werden nicht unterstützt und wurden ausgelassen.`
      );
    }

    const secretRaw = vevent.getFirstPropertyValue(SECRET_PROP);
    const seq = vevent.getFirstPropertyValue("sequence");

    return {
      id: newId(),
      title: String(event.summary ?? ""),
      location: String(event.location ?? ""),
      description: String(event.description ?? ""),
      secretDetails: typeof secretRaw === "string" ? secretRaw : "",
      isAllDay,
      startDate: start.date,
      startTime: isAllDay ? null : start.time,
      endDate,
      endTime: isAllDay ? null : end.time,
      isImportant: parsePriority(vevent),
      color: null,
      rrule,
      exdates: rrule ? parseExdates(vevent) : [],
      parentId: null,
      recurrenceAnchor: null,
      icsUid: raw.uid,
      icsSequence: typeof seq === "number" ? seq : 0,
      tagIds: [],
      reminders: valarmMinutes(vevent, warnings).map((m) => ({
        id: newId(),
        minutesBefore: m,
      })),
      createdAt: now,
      updatedAt: now,
    };
  };

  // Erst Master/Einzeltermine, dann Overrides (brauchen die Master-IDs).
  for (const raw of raws) {
    if (raw.isOverride) continue;
    const appt = buildBase(raw);
    if (raw.uid) {
      masterIdByUid.set(raw.uid, appt.id);
      masterByUid.set(raw.uid, raw);
    } else {
      warnings.push(
        `„${appt.title || "(ohne Titel)"}“ hat keine UID – ein erneuter Import derselben Datei legt ihn doppelt an.`
      );
    }
    items.push({ appointment: appt, categories: parseCategories(raw.vevent) });
  }

  for (const raw of raws) {
    if (!raw.isOverride) continue;
    const masterId = raw.uid ? masterIdByUid.get(raw.uid) : undefined;
    const appt = buildBase(raw);
    if (!masterId) {
      // Override ohne Master in der Datei: als eigenständiger Termin
      // übernehmen, statt ihn zu verlieren.
      warnings.push(
        `„${appt.title || "(ohne Titel)"}“ ist eine Serien-Ausnahme ohne zugehörige Serie – als Einzeltermin übernommen.`
      );
      appt.icsUid = null; // sonst kollidiert er beim Re-Import mit der Serie
      items.push({ appointment: appt, categories: parseCategories(raw.vevent) });
      continue;
    }
    const master = masterByUid.get(raw.uid!)!;
    const recIdRaw = raw.vevent.getFirstPropertyValue("recurrence-id");
    const anchor =
      recIdRaw instanceof ICAL.Time
        ? toLocalParts(recIdRaw).date
        : appt.startDate;
    appt.parentId = masterId;
    appt.recurrenceAnchor = anchor;
    appt.rrule = null;
    appt.exdates = [];
    appt.icsUid = null; // UID gehört dem Master (Override-Zuordnung via Anker)
    appt.icsSequence = 0;
    appt.reminders = []; // erben vom Master
    // Ganztägig-Status folgt dem Master (DB-CHECK: einheitliche Zeitfelder).
    if (master.event.startDate.isDate !== appt.isAllDay) {
      if (appt.isAllDay) {
        appt.isAllDay = false;
        appt.startTime = "09:00";
        appt.endTime = "10:00";
      }
    }
    items.push({ appointment: appt, categories: [] });
  }

  if (items.length === 0) {
    throw new Error("Die ICS-Datei enthält keine importierbaren Termine.");
  }
  return { items, warnings };
}
