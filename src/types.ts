// Zentrale Datentypen der App.

export interface Objection {
  id: string;
  reason: string; // Begründung des Widerspruchs
  byWhom: string; // Wer hat widersprochen (Name/Funktion)
  date: string | null; // optional, YYYY-MM-DD
}

// Basis eines Eintrags OHNE das vertrauliche `secretDetails`. Dient als schlanke
// Grundlage für Listen-/Kalender-/Suchansichten: so kann das BR-Geheimnis dort
// strukturell (nicht nur per UI-Konvention) gar nicht erst geladen werden.
export interface TimeEntryBase {
  id: string;
  date: string; // YYYY-MM-DD (tagesgenau)
  startTime: string | null; // HH:mm, optional
  endTime: string | null; // HH:mm, optional
  durationMinutes: number; // abgerechnete (NETTO-)Dauer in Minuten (Kernwert)
  pauseMinutes: number; // Pause in Minuten, nur bei Von/Bis-Erfassung relevant (0 bei direkter Dauer-Eingabe); bereits von durationMinutes abgezogen
  infoForManagement: string; // Was die Geschäftsleitung erfahren darf
  hadPlannedShift: boolean; // geplante Schicht zu der Zeit?
  shiftCompensationNote: string; // Freitext, nur relevant wenn hadPlannedShift = false
  isCompensation?: boolean; // Eintrag ist Freizeitausgleich (§37 Abs. 3 BetrVG); Auswertung folgt später
  tagIds: string[]; // Schlagwörter (Mehrfachauswahl)
  objections: Objection[]; // mehrere GL-Widersprüche möglich
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// Vollständiger Eintrag inkl. BR-Geheimnis. Nur dort verwenden, wo das
// vertrauliche Feld wirklich gebraucht wird: Formular, Detailansicht, Backup,
// vertraulicher Voll-Export.
export interface TimeEntry extends TimeEntryBase {
  secretDetails: string; // BR-Geheimnis – nie im GL-Export, nie in Listen im Klartext
}

export interface TaskTag {
  id: string;
  label: string;
  archived: boolean;
}

// Suchtreffer-Herkunft pro Eintrag (spaltengebunden bestimmt, ohne Klartext-Leak).
export interface SearchHit {
  hasPublicHit: boolean;
  hasSecretHit: boolean;
}

// Eintrag wie in der Übersichtsliste dargestellt – bewusst OHNE `secretDetails`
// (erbt von TimeEntryBase, nicht von TimeEntry). Verhindert, dass das BR-Geheimnis
// überhaupt in Listen-/Kalender-/Suchansichten geladen wird.
export interface EntryListItem extends TimeEntryBase {
  tagLabels: string[];
  search?: SearchHit;
}

// Voll geladener Eintrag inkl. `secretDetails` und Schlagwort-Labels. Für die
// Detailansicht (getEntry-Refetch) und den vertraulichen Voll-CSV-Export.
export interface EntryFullItem extends TimeEntry {
  tagLabels: string[];
  search?: SearchHit;
}

// Filter für die Übersichtsliste.
export interface EntryFilter {
  from?: string | null; // YYYY-MM-DD
  to?: string | null; // YYYY-MM-DD
  tagIds?: string[]; // UND-/ODER-Logik siehe Repository (Default: mindestens einer)
  term?: string; // Volltextsuche
}

// ---------- Terminkalender ----------

// Feste Farbpalette für Termine (Schlüssel -> Tailwind-Mapping im Frontend);
// bewusst kein Freitext/Hex, damit Dark-Mode-Varianten zentral definierbar sind.
export type AppointmentColor = "sky" | "amber" | "emerald" | "violet" | "rose";

// Erinnerungs-Vorlauf eines Termins. Die `id` MUSS über Bearbeitungen hinweg
// stabil bleiben: `reminder_fired` referenziert sie mit ON DELETE CASCADE --
// ein DELETE+INSERT beim Speichern würde das Feuer-Protokoll mitreißen und
// bereits gezeigte Erinnerungen erneut feuern lassen (Repository schreibt
// deshalb DIFF-basiert).
export interface AppointmentReminder {
  id: string;
  minutesBefore: number; // 0 = zum Terminbeginn
}

// Basis eines Termins OHNE das vertrauliche `secretDetails` -- dasselbe
// Struktur-Muster wie TimeEntryBase: Kalender-/Agenda-/Suchansichten können
// das BR-Geheimnis gar nicht erst laden.
export interface AppointmentBase {
  id: string;
  title: string;
  location: string;
  description: string; // öffentliche Beschreibung
  isAllDay: boolean;
  startDate: string; // YYYY-MM-DD (lokale Wandzeit, wie app-weit)
  startTime: string | null; // HH:mm, null bei ganztägig
  endDate: string; // YYYY-MM-DD, INKLUSIV (letzter Termintag; ICS-DTEND-Konvertierung nur in ics.ts)
  endTime: string | null; // HH:mm, null bei ganztägig
  isImportant: boolean;
  color: AppointmentColor | null;
  // Serien nach ICS-Modell: RRULE-Body ohne "RRULE:"-Präfix, null = Einzeltermin.
  rrule: string | null;
  // NUR gelöschte Einzelinstanzen (YYYY-MM-DD-Anker). Bearbeitete Instanzen
  // sind Override-Zeilen (parentId + recurrenceAnchor), NIE zusätzlich Exdate.
  exdates: string[];
  parentId: string | null; // gesetzt: diese Zeile ist ein Serien-Override
  recurrenceAnchor: string | null; // YYYY-MM-DD der ursprünglichen Instanz
  icsUid: string | null; // UID aus ICS-Import bzw. für Re-Import-Dedupe
  icsSequence: number;
  tagIds: string[]; // task_tags-Verweise (Vorbefüllung bei "Zeit buchen")
  reminders: AppointmentReminder[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// Vollständiger Termin inkl. BR-Geheimnis. Nur für Formular, Detailansicht,
// Backup und expliziten Vertraulich-Export.
export interface Appointment extends AppointmentBase {
  secretDetails: string;
}

// Termin wie in Kalender/Agenda dargestellt -- bewusst OHNE `secretDetails`.
export interface AppointmentListItem extends AppointmentBase {
  tagLabels: string[];
  search?: SearchHit;
}

// Voll geladener Termin inkl. `secretDetails` und Schlagwort-Labels.
export interface AppointmentFullItem extends Appointment {
  tagLabels: string[];
}

// Feuer-Protokoll einer Erinnerung (Teil des Backups, damit ein Restore
// bereits gezeigte Erinnerungen nicht erneut feuert).
export interface ReminderFired {
  appointmentId: string;
  reminderId: string;
  occurrenceAnchor: string; // YYYY-MM-DD; bei Einzelterminen = startDate
  firedAt: string; // ISO
}

// Vollständiges Backup-Format (JSON-Export/-Import).
// schemaVersion 2 ergänzt Termine; beide Felder optional, damit v1-Backups
// (ohne Termine) unverändert importierbar bleiben.
export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  app: string;
  tags: TaskTag[];
  entries: TimeEntry[];
  appointments?: Appointment[];
  reminderFired?: ReminderFired[];
}

// Ein konkret betroffener Eintrag in der Import-Konflikt-Preview.
export interface ConflictItem {
  id: string; // bereits lokal existierende UUID
  date: string; // Datum des lokalen Eintrags, der überschrieben würde
  label: string; // Kurzbeschreibung (Info/Schlagwörter) des lokalen Eintrags
}

// Ergebnis-Zusammenfassung der JSON-Import-Analyse (vor dem Schreiben).
export interface ImportSummary {
  newEntries: number; // unbekannte UUIDs
  conflicts: number; // bekannte UUID, importierte Version neuer -> gewinnt
  unchanged: number; // bekannte UUID, gleich/älter -> bleibt lokal
  newTags: number; // fehlende Tags, die mit angelegt werden
  conflictItems: ConflictItem[]; // konkret überschriebene lokale Einträge (Preview)
  // Termin-Zähler (dieselbe Last-Writer-Wins-Logik wie Einträge). Optional,
  // damit v1-Backups ohne Termine keine Sonderbehandlung in der UI brauchen.
  newAppointments?: number;
  appointmentConflicts?: number;
  appointmentUnchanged?: number;
}
