// Idempotente Schema-Definition. Wird bei jedem App-Start ausgeführt
// (CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE) – KEINE prüfsummen-validierte
// Migration mehr. Dadurch unabhängig von Zeilenenden/Build-Umgebung und
// kompatibel mit allen bereits bestehenden Datenbanken.
//
// Künftige Schemaänderungen: hier idempotent ergänzen; für komplexere Fälle
// PRAGMA user_version als eigene, schlanke Versionierung nutzen.

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS entries (
     id                      TEXT PRIMARY KEY,
     date                    TEXT NOT NULL,
     start_time              TEXT,
     end_time                TEXT,
     duration_minutes        INTEGER NOT NULL DEFAULT 0,
     info_for_management     TEXT NOT NULL DEFAULT '',
     secret_details          TEXT NOT NULL DEFAULT '',
     had_planned_shift       INTEGER NOT NULL DEFAULT 1,
     shift_compensation_note TEXT NOT NULL DEFAULT '',
     created_at              TEXT NOT NULL,
     updated_at              TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date)`,
  `CREATE TABLE IF NOT EXISTS task_tags (
     id       TEXT PRIMARY KEY,
     label    TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS entry_tags (
     entry_id TEXT NOT NULL,
     tag_id   TEXT NOT NULL,
     PRIMARY KEY (entry_id, tag_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id)`,
  `CREATE TABLE IF NOT EXISTS objections (
     id       TEXT PRIMARY KEY,
     entry_id TEXT NOT NULL,
     reason   TEXT NOT NULL DEFAULT '',
     by_whom  TEXT NOT NULL DEFAULT '',
     date     TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_objections_entry ON objections(entry_id)`,
  // Standard-Schlagwörter mit festen, hart kodierten UUIDs (deterministisch über
  // alle Geräte -> merge-sicher). INSERT OR IGNORE -> idempotent.
  `INSERT OR IGNORE INTO task_tags (id, label, archived) VALUES
     ('11111111-1111-4111-8111-111111110001', 'BR-Sitzung', 0),
     ('11111111-1111-4111-8111-111111110002', 'Ausschuss-Sitzung', 0),
     ('11111111-1111-4111-8111-111111110003', 'Betriebsausschuss', 0),
     ('11111111-1111-4111-8111-111111110004', 'Wirtschaftsausschuss', 0),
     ('11111111-1111-4111-8111-111111110005', 'Fahrzeit', 0),
     ('11111111-1111-4111-8111-111111110006', 'Sprechstunde', 0),
     ('11111111-1111-4111-8111-111111110007', 'Schulung/Seminar (§ 37 BetrVG)', 0),
     ('11111111-1111-4111-8111-111111110008', 'Einzel-/Mitarbeitergespräch', 0),
     ('11111111-1111-4111-8111-111111110009', 'Vor-/Nachbereitung', 0),
     ('11111111-1111-4111-8111-111111110010', 'Verhandlung mit Arbeitgeber/Monatsgespräch', 0),
     ('11111111-1111-4111-8111-111111110011', 'Betriebsbegehung', 0),
     ('11111111-1111-4111-8111-111111110012', 'Personalgespräch/Anhörung', 0),
     ('11111111-1111-4111-8111-111111110013', 'Einigungsstelle', 0),
     ('11111111-1111-4111-8111-111111110014', 'JAV-Sitzung', 0),
     ('11111111-1111-4111-8111-111111110015', 'Gesamt-/Konzernbetriebsrat', 0),
     ('11111111-1111-4111-8111-111111110016', 'Verwaltung (E-Mail/Telefon)', 0),
     ('11111111-1111-4111-8111-111111110017', 'Sonstige BR-Tätigkeit', 0)`,
];
