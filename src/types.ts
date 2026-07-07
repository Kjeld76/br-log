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

// Vollständiges Backup-Format (JSON-Export/-Import).
export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  app: string;
  tags: TaskTag[];
  entries: TimeEntry[];
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
}
