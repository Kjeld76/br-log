// Zentrale Datentypen der App.

export interface Objection {
  id: string;
  reason: string; // Begründung des Widerspruchs
  byWhom: string; // Wer hat widersprochen (Name/Funktion)
  date: string | null; // optional, YYYY-MM-DD
}

export interface TimeEntry {
  id: string;
  date: string; // YYYY-MM-DD (tagesgenau)
  startTime: string | null; // HH:mm, optional
  endTime: string | null; // HH:mm, optional
  durationMinutes: number; // abgerechnete Dauer in Minuten (Kernwert)
  infoForManagement: string; // Was die Geschäftsleitung erfahren darf
  secretDetails: string; // BR-Geheimnis – nie im GL-Export, nie in Listen im Klartext
  hadPlannedShift: boolean; // geplante Schicht zu der Zeit?
  shiftCompensationNote: string; // Freitext, nur relevant wenn hadPlannedShift = false
  tagIds: string[]; // Schlagwörter (Mehrfachauswahl)
  objections: Objection[]; // mehrere GL-Widersprüche möglich
  createdAt: string; // ISO
  updatedAt: string; // ISO
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

// Eintrag wie in der Übersichtsliste dargestellt.
export interface EntryListItem extends TimeEntry {
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
