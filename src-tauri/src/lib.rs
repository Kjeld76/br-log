use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde_json::{json, Map, Number, Value as JsonValue};
use tauri::{Manager, State};
use zeroize::Zeroizing;

mod app_settings;
mod crypto;
mod db_location;
mod file_io;
#[cfg(desktop)]
mod tray;
use db_location::DbLocation;

/// Entsperrter DB-Zustand: offene (verschlüsselte) Connection + die DEK im
/// Speicher. None = GESPERRT (keine Connection, kein Schlüssel im RAM). Beim
/// Sperren wird das Some durch None ersetzt -> Connection wird gedroppt
/// (SQLCipher gibt seinen internen Schlüssel frei) und die DEK zeroized.
struct KeyedConn {
    conn: Connection,
    #[allow(dead_code)]
    dek: Zeroizing<[u8; 32]>,
}
type DbState = Mutex<Option<KeyedConn>>;

/// Aufgelöster DB-Pfad + Modus (portabel/installiert) – Anzeige (DbInfoPanel)
/// und Ablageort der Klartext-App-Einstellungen (app_settings.rs).
pub(crate) struct AppDbLocation(pub(crate) DbLocation);

/// Strukturierter Entsperr-/Krypto-Fehler: falsches Geheimnis (Retry+Backoff)
/// strikt getrennt von echten DB-/Keyfile-Fehlern (kein Backoff).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum CryptoCmdError {
    WrongSecret,
    Corrupt { message: String },
    DbError { message: String },
}

impl From<crypto::UnwrapError> for CryptoCmdError {
    fn from(e: crypto::UnwrapError) -> Self {
        match e {
            crypto::UnwrapError::WrongSecret => CryptoCmdError::WrongSecret,
            crypto::UnwrapError::Corrupt(m) => CryptoCmdError::Corrupt { message: m },
        }
    }
}
fn db_err(m: impl Into<String>) -> CryptoCmdError {
    CryptoCmdError::DbError { message: m.into() }
}

// ---------- Datei-IO (Export/Import, Recovery-Code-TXT) ----------
//
// Die Commands `export_text_file` / `export_binary_file` / `import_text_file`
// leben in file_io.rs (Linux-Portierung: Dialog-Aufruf + atomares
// Schreiben/Lesen dort gekapselt, Struktur bereit für einen späteren
// Android-Arm). Die früheren Commands `write_text_file` / `read_text_file`
// (Pfad kam als String vom Frontend, das den Dialog selbst geöffnet hatte)
// sind damit entfallen.

// ---------- DB-Layer (rusqlite/SQLCipher) ----------

fn json_to_sql(v: &JsonValue) -> Result<SqlValue, String> {
    Ok(match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(u) = n.as_u64() {
                i64::try_from(u)
                    .map(SqlValue::Integer)
                    .unwrap_or(SqlValue::Real(u as f64))
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                return Err(format!("Nicht unterstützte Zahl: {n}"));
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        other @ (JsonValue::Array(_) | JsonValue::Object(_)) => SqlValue::Text(other.to_string()),
    })
}

/// INSERT/UPDATE/DELETE/DDL. Erfordert eine entsperrte DB.
#[tauri::command]
fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<usize, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let kc = guard.as_ref().ok_or_else(|| "DB gesperrt".to_string())?;
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
    kc.conn
        .execute(&sql, rusqlite::params_from_iter(sql_params.iter()))
        .map_err(|e| e.to_string())
}

/// SELECT. Erfordert eine entsperrte DB. Liefert Zeilen-Objekte (snake_case).
#[tauri::command]
fn db_select(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let kc = guard.as_ref().ok_or_else(|| "DB gesperrt".to_string())?;
    let mut stmt = kc.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let col_names: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let col_count = col_names.len();
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(sql_params.iter()))
        .map_err(|e| e.to_string())?;
    let mut out: Vec<Map<String, JsonValue>> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::with_capacity(col_count);
        for (i, name) in col_names.iter().enumerate() {
            let v = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => JsonValue::Null,
                ValueRef::Integer(n) => JsonValue::Number(n.into()),
                ValueRef::Real(f) => Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null),
                ValueRef::Text(bytes) => JsonValue::String(String::from_utf8_lossy(bytes).into_owned()),
                ValueRef::Blob(bytes) => {
                    JsonValue::Array(bytes.iter().map(|b| JsonValue::Number((*b).into())).collect())
                }
            };
            obj.insert(name.clone(), v);
        }
        out.push(obj);
    }
    Ok(out)
}

/// Ein einzelnes Statement innerhalb einer Batch-Transaktion.
#[derive(serde::Deserialize)]
struct BatchStatement {
    sql: String,
    params: Vec<JsonValue>,
}

/// Führt mehrere Schreib-Statements ATOMAR in EINER Transaktion aus. Ersetzt
/// manuelle BEGIN/COMMIT-Strings aus dem Frontend (über getrennte Aufrufe nicht
/// verlässlich). Schlägt ein Statement fehl, wird die gesamte Transaktion
/// zurückgerollt -> kein Teildatenverlust bei Mehrschritt-Schreiboperationen.
#[tauri::command]
fn db_batch(state: State<'_, DbState>, statements: Vec<BatchStatement>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let kc = guard.as_mut().ok_or_else(|| "DB gesperrt".to_string())?;
    let tx = kc.conn.transaction().map_err(|e| e.to_string())?;
    for st in &statements {
        let p: Vec<SqlValue> = st.params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
        tx.execute(&st.sql, rusqlite::params_from_iter(p.iter()))
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Schema-Migrationen (PRAGMA user_version) ----------

/// Höchste vom Code unterstützte Schema-Version.
const SCHEMA_VERSION: i64 = 4;

/// Migration 1: Schema-Härtung eines v0-Bestands (Tabellen-Neubau nach dem
/// SQLite-Standardverfahren, da SQLite kein ADD CONSTRAINT kennt):
///  - id überall NOT NULL PRIMARY KEY (verhindert mehrfache NULL-id-Zeilen),
///  - CHECK(duration_minutes >= 0) (Altbestand mit Negativwert wird auf 0 geklemmt,
///    damit die Migration nie an Alt-Daten scheitert),
///  - neue Spalte is_compensation (Default 0, Auswertung folgt später),
///  - Fremdschlüssel entry_tags/objections -> entries(id) ON DELETE CASCADE und
///    entry_tags -> task_tags(id) ON DELETE CASCADE,
///  - UNIQUE(label COLLATE NOCASE) auf task_tags; vorhandene, nur in der
///    Groß-/Kleinschreibung abweichende Duplikate werden vorher gemergt
///    (Überlebender = kleinste id, entry_tags werden umgehängt),
///  - Waisen (Kindzeilen ohne existierenden Eintrag/Tag) werden verworfen.
/// Bewusst KEIN CHECK auf Start/Ende-Kombinationen: Einträge ohne Start/Ende mit
/// Dauer > 0 und Über-Mitternacht (end < start) bleiben erlaubt.
const MIGRATE_V1_SQL: &str = r#"
CREATE TABLE entries_new (
  id                      TEXT PRIMARY KEY NOT NULL,
  date                    TEXT NOT NULL,
  start_time              TEXT,
  end_time                TEXT,
  duration_minutes        INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  info_for_management     TEXT NOT NULL DEFAULT '',
  secret_details          TEXT NOT NULL DEFAULT '',
  had_planned_shift       INTEGER NOT NULL DEFAULT 1,
  shift_compensation_note TEXT NOT NULL DEFAULT '',
  is_compensation         INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
INSERT INTO entries_new
  (id,date,start_time,end_time,duration_minutes,info_for_management,secret_details,
   had_planned_shift,shift_compensation_note,is_compensation,created_at,updated_at)
  SELECT id,date,start_time,end_time,
         CASE WHEN duration_minutes < 0 THEN 0 ELSE duration_minutes END,
         info_for_management,secret_details,had_planned_shift,shift_compensation_note,
         0,created_at,updated_at
    FROM entries
   WHERE id IS NOT NULL;
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
CREATE INDEX idx_entries_date ON entries(date);

CREATE TABLE task_tags_new (
  id       TEXT PRIMARY KEY NOT NULL,
  label    TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (label COLLATE NOCASE)
);
INSERT INTO task_tags_new (id,label,archived)
  SELECT id,label,archived FROM task_tags tt
   WHERE id IS NOT NULL
     AND id = (SELECT min(id) FROM task_tags t2 WHERE lower(t2.label) = lower(tt.label));

CREATE TABLE entry_tags_new (
  entry_id TEXT NOT NULL,
  tag_id   TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES entries(id)   ON DELETE CASCADE,
  FOREIGN KEY (tag_id)   REFERENCES task_tags(id) ON DELETE CASCADE
);
INSERT INTO entry_tags_new (entry_id, tag_id)
  SELECT DISTINCT et.entry_id, surv.sid
    FROM entry_tags et
    JOIN task_tags t ON t.id = et.tag_id
    JOIN (SELECT lower(label) AS lbl, min(id) AS sid FROM task_tags GROUP BY lower(label)) surv
      ON surv.lbl = lower(t.label)
    JOIN entries en ON en.id = et.entry_id;
DROP TABLE entry_tags;
ALTER TABLE entry_tags_new RENAME TO entry_tags;
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

DROP TABLE task_tags;
ALTER TABLE task_tags_new RENAME TO task_tags;

CREATE TABLE objections_new (
  id       TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL,
  reason   TEXT NOT NULL DEFAULT '',
  by_whom  TEXT NOT NULL DEFAULT '',
  date     TEXT,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
INSERT INTO objections_new (id,entry_id,reason,by_whom,date)
  SELECT o.id,o.entry_id,o.reason,o.by_whom,o.date
    FROM objections o
    JOIN entries en ON en.id = o.entry_id
   WHERE o.id IS NOT NULL;
DROP TABLE objections;
ALTER TABLE objections_new RENAME TO objections;
CREATE INDEX idx_objections_entry ON objections(entry_id);
"#;

/// Migration 2 (Pause bei Von/Bis-Erfassung): neue Spalte `pause_minutes` an
/// `entries`. Reines additives ALTER TABLE ADD COLUMN statt Tabellen-Neubau
/// (anders als Migration 1) -- SQLite erlaubt seit 3.25.0 auch eine CHECK-
/// Klausel in ADD COLUMN, solange sie sich nur auf die neue Spalte selbst
/// bezieht (kein Spaltenvergleich, keine Fremdspalten). Bestandszeilen
/// erhalten automatisch den DEFAULT 0 (erfüllt die CHECK trivial), künftige
/// INSERT/UPDATE-Versuche mit negativer Pause werden von der DB abgelehnt --
/// zusätzlich zur TS-seitigen Validierung in time.ts/EntryForm.tsx (Rust/TS
/// als zwei unabhängige Verteidigungslinien, wie schon bei duration_minutes
/// in Migration 1).
const MIGRATE_V2_SQL: &str =
    "ALTER TABLE entries ADD COLUMN pause_minutes INTEGER NOT NULL DEFAULT 0 CHECK (pause_minutes >= 0);";

/// Migration 3 (Terminkalender): vier neue Tabellen, rein additiv -- kein
/// Tabellen-Neubau, kein FK-Aus/An (anders als Migration 1).
///
/// Datenmodell-Entscheidungen (Details im Plan):
///  - Serien nach ICS-Modell: Master-Zeile mit `rrule` (RRULE-Body ohne
///    "RRULE:"-Präfix); `exdates` (JSON-Array von YYYY-MM-DD) NUR für
///    gelöschte Einzelinstanzen; bearbeitete Instanzen sind eigene
///    Override-Zeilen (parent_id + recurrence_anchor = RECURRENCE-ID-
///    Semantik) und NIE zusätzlich Exdate -- so bleibt der ICS-Export eine
///    1:1-Abbildung ohne Doppelbuchhaltung.
///  - recurrence_anchor ist NUR das Datum (YYYY-MM-DD) der ursprünglichen
///    Instanz: überlebt eine "alle Termine"-Uhrzeitänderung der Serie.
///    Folge: max. eine Instanz pro Tag je Serie (eigene Presets erzeugen
///    nie mehr; mehrfach-tägliche ICS-Importe werden vereinfacht).
///  - end_date ist INKLUSIV (letzter Termintag), konsistent zum restlichen
///    Wandzeit-Modell der App; die DTEND-Exklusivität von ICS wird
///    ausschließlich in src/lib/ics.ts konvertiert.
///  - secret_details folgt dem BR-Geheimnis-Muster von entries: Listen-/
///    Kalenderpfade laden die Spalte strukturell nie (LIST_APPT_COLUMNS).
///  - Erinnerungen (appointment_reminders) hängen am Master; Overrides
///    erben die Offsets. reminder_fired protokolliert je (Termin,
///    Erinnerung, Instanz-Anker) das Feuern -- einzige Form, die Serien +
///    Mehrfach-Erinnerungen ohne Doppelfeuern trägt. Die Reminder-IDs
///    müssen dafür STABIL bleiben (DIFF-Schreiben im Repository statt
///    DELETE+INSERT, sonst reißt ON DELETE CASCADE die fired-Zeilen mit).
const MIGRATE_V3_SQL: &str = r#"
CREATE TABLE appointments (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  secret_details    TEXT NOT NULL DEFAULT '',
  is_all_day        INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0,1)),
  start_date        TEXT NOT NULL,
  start_time        TEXT,
  end_date          TEXT NOT NULL,
  end_time          TEXT,
  is_important      INTEGER NOT NULL DEFAULT 0,
  color             TEXT,
  rrule             TEXT,
  exdates           TEXT NOT NULL DEFAULT '[]',
  parent_id         TEXT REFERENCES appointments(id) ON DELETE CASCADE,
  recurrence_anchor TEXT,
  ics_uid           TEXT,
  ics_sequence      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (is_all_day = 1 OR (start_time IS NOT NULL AND end_time IS NOT NULL)),
  CHECK (is_all_day = 0 OR (start_time IS NULL AND end_time IS NULL)),
  CHECK (parent_id IS NULL OR recurrence_anchor IS NOT NULL),
  CHECK (parent_id IS NULL OR rrule IS NULL)
);
CREATE INDEX idx_appointments_start ON appointments(start_date);
CREATE INDEX idx_appointments_end   ON appointments(end_date);
CREATE INDEX idx_appointments_uid   ON appointments(ics_uid) WHERE ics_uid IS NOT NULL;
CREATE UNIQUE INDEX idx_appointments_override
  ON appointments(parent_id, recurrence_anchor) WHERE parent_id IS NOT NULL;

CREATE TABLE appointment_tags (
  appointment_id TEXT NOT NULL,
  tag_id         TEXT NOT NULL,
  PRIMARY KEY (appointment_id, tag_id),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)         REFERENCES task_tags(id)    ON DELETE CASCADE
);
CREATE INDEX idx_appointment_tags_tag ON appointment_tags(tag_id);

CREATE TABLE appointment_reminders (
  id             TEXT PRIMARY KEY NOT NULL,
  appointment_id TEXT NOT NULL,
  minutes_before INTEGER NOT NULL CHECK (minutes_before >= 0),
  UNIQUE (appointment_id, minutes_before),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE reminder_fired (
  appointment_id    TEXT NOT NULL,
  reminder_id       TEXT NOT NULL,
  occurrence_anchor TEXT NOT NULL,
  fired_at          TEXT NOT NULL,
  PRIMARY KEY (appointment_id, reminder_id, occurrence_anchor),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)          ON DELETE CASCADE,
  FOREIGN KEY (reminder_id)    REFERENCES appointment_reminders(id) ON DELETE CASCADE
);
"#;

/// Migration 4 (Issue #4, Task 1 von 3): neue Spalte `series_end_date` an
/// `appointments`. Reines ADD COLUMN, kein Tabellen-Neubau, kein FK-Aus/An
/// (Muster von Migration 2).
///
/// Abgeleitete Spalte NUR für Serien-Master (`rrule IS NOT NULL`): letzter
/// Tag, den die Serie berühren kann (letzter Instanz-Anker + Mehrtages-
/// Spanne), KONSERVATIV (darf zu spät, nie zu früh sein). NULL = endlos oder
/// unbekannt (bleibt im Hot-Path). Berechnung ausschließlich TS-seitig
/// (`lib/appointments.ts` via ical.js -- Rust hat keinen RRULE-Parser);
/// Bestands-Backfill läuft beim App-Start (`backfillSeriesEndDates`), nicht
/// in der Migration.
const MIGRATE_V4_SQL: &str = "ALTER TABLE appointments ADD COLUMN series_end_date TEXT;";

fn user_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Führt ausstehende Schema-Migrationen aus. Jede Migration läuft in EINER
/// Transaktion; PRAGMA user_version verfolgt den Stand, sodass künftige
/// Schemaänderungen Bestands-DBs zuverlässig erreichen (nicht mehr per
/// idempotentem CREATE, das auf Alt-DBs stillschweigend ins Leere liefe).
/// Downgrade-Schutz: eine mit neuerer App erzeugte DB wird nicht geöffnet.
/// Setzt voraus, dass das v0-Basisschema bereits existiert (Frontend legt es
/// via schema.ts idempotent an, bevor db_migrate aufgerufen wird).
fn run_migrations(conn: &mut Connection) -> Result<i64, String> {
    let version = user_version(conn)?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "Diese Datenbank wurde mit einer neueren App-Version erstellt (Schema-Version {version}, unterstützt bis {SCHEMA_VERSION}). Bitte die App aktualisieren."
        ));
    }
    if version < 1 {
        // Tabellen-Neubau erfordert deaktivierte Fremdschlüssel; PRAGMA
        // foreign_keys wirkt NUR außerhalb einer Transaktion.
        conn.execute_batch("PRAGMA foreign_keys=OFF;")
            .map_err(|e| e.to_string())?;
        let res = (|| -> Result<(), String> {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch(MIGRATE_V1_SQL)
                .map_err(|e| format!("Migration 1 fehlgeschlagen: {e}"))?;
            // Integritätskontrolle vor dem Commit: keine verwaisten Referenzen.
            {
                let mut stmt = tx
                    .prepare("PRAGMA foreign_key_check")
                    .map_err(|e| e.to_string())?;
                let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
                if rows.next().map_err(|e| e.to_string())?.is_some() {
                    return Err("Fremdschlüssel-Verletzung nach Migration 1".to_string());
                }
            }
            tx.execute_batch("PRAGMA user_version=1;")
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })();
        // Fremdschlüssel wieder aktivieren – unabhängig von Erfolg/Fehler.
        let _ = conn.execute_batch("PRAGMA foreign_keys=ON;");
        res?;
    }
    if version < 2 {
        // Reines ADD COLUMN -- kein Tabellen-Neubau, kein FK-Aus/An nötig.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(MIGRATE_V2_SQL)
            .map_err(|e| format!("Migration 2 fehlgeschlagen: {e}"))?;
        tx.execute_batch("PRAGMA user_version=2;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 3 {
        // Nur neue Tabellen -- kein Tabellen-Neubau, kein FK-Aus/An nötig.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(MIGRATE_V3_SQL)
            .map_err(|e| format!("Migration 3 fehlgeschlagen: {e}"))?;
        tx.execute_batch("PRAGMA user_version=3;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 4 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(MIGRATE_V4_SQL)
            .map_err(|e| format!("Migration 4 fehlgeschlagen: {e}"))?;
        tx.execute_batch("PRAGMA user_version=4;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(SCHEMA_VERSION)
}

/// Führt die Schema-Migrationen auf der offenen (entsperrten) DB aus. Wird vom
/// Frontend nach dem Anlegen des v0-Basisschemas aufgerufen (client.initSchema).
#[tauri::command]
fn db_migrate(state: State<'_, DbState>) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let kc = guard.as_mut().ok_or_else(|| "DB gesperrt".to_string())?;
    run_migrations(&mut kc.conn)
}

/// Pfad + Modus für die Anzeige (DbInfoPanel).
#[tauri::command]
fn db_path(state: State<'_, AppDbLocation>) -> JsonValue {
    let has_bak = state
        .0
        .data_dir
        .join("br_zeiten.db.pre-encrypt.bak")
        .exists();
    json!({
        "dbFile": state.0.db_file.to_string_lossy(),
        "dataDir": state.0.data_dir.to_string_lossy(),
        "portable": state.0.portable,
        "hasPlaintextBackup": has_bak,
    })
}

// ---------- Krypto / Entsperren ----------

/// Liest die ersten 16 Bytes: ein unverschlüsseltes SQLite beginnt mit
/// "SQLite format 3\0". Bei SQLCipher ist der Header ein zufälliges Salt.
fn is_plaintext_db(path: &Path) -> bool {
    use std::io::Read;
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut hdr = [0u8; 16];
    matches!(f.read_exact(&mut hdr), Ok(())) && &hdr == b"SQLite format 3\0"
}

/// Öffnet die verschlüsselte DB mit der DEK als SQLCipher-Rohschlüssel.
fn open_keyed(db_file: &Path, dek: &[u8; 32]) -> Result<Connection, CryptoCmdError> {
    if let Some(parent) = db_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| db_err(e.to_string()))?;
    }
    let conn = Connection::open(db_file).map_err(|e| db_err(e.to_string()))?;
    let pragma = Zeroizing::new(format!("PRAGMA key = \"{}\";", &*crypto::dek_pragma_literal(dek)));
    conn.execute_batch(&pragma).map_err(|e| db_err(e.to_string()))?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .map_err(|e| db_err(e.to_string()))?;
    // Probe: bestätigt, dass der Schlüssel die DB öffnet (Korruption sonst hier).
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|e| db_err(format!("DB nicht entschlüsselbar: {e}")))?;
    Ok(conn)
}

fn data_dir(loc: &State<'_, AppDbLocation>) -> PathBuf {
    loc.0.data_dir.clone()
}

/// Startentscheidung: firstRun | needsMigration | encrypted | keyfileMissing | error.
/// Reine Pfad-/Dateilogik ohne Tauri-State -> ohne echte SQLCipher-Datei testbar
/// (siehe db_status_tests unten).
fn compute_db_status(dir: &Path, db_file: &Path) -> JsonValue {
    let db_exists = db_file.exists();
    let plaintext = db_exists && is_plaintext_db(db_file);
    // WICHTIG: V2-Keyfile gilt nur als "encrypted", wenn die DB auch wirklich
    // verschlüsselt ist. Liegt ein V2-Keyfile NEBEN einer noch-Klartext-DB, wurde
    // die Migration zwischen Keyfile-Schreiben und DB-Swap unterbrochen -> die DB
    // ist noch Klartext und muss (idempotent) erneut migriert werden, statt in eine
    // nicht-entsperrbare Sackgasse zu laufen.
    match crypto::classify_keyfile(dir) {
        crypto::KeyfileState::V2(kf) if !plaintext => {
            json!({ "mode": "encrypted", "autoLockMinutes": kf.auto_lock_minutes })
        }
        crypto::KeyfileState::Corrupt(m) if !plaintext => {
            json!({ "mode": "error", "autoLockMinutes": 5, "message": format!("Schlüsseldatei beschädigt: {m}") })
        }
        crypto::KeyfileState::V1 { auto_lock_minutes } if plaintext => {
            json!({ "mode": "needsMigration", "autoLockMinutes": auto_lock_minutes })
        }
        // Verschlüsselte DB vorhanden (existiert, kein Klartext-Header), aber
        // keyfile.json fehlt komplett (gelöscht/nicht mitkopiert). NICHT als
        // firstRun behandeln -> crypto_setup würde sonst "neu einrichten"
        // anbieten und liefe beim Anlegen zwar ins Vorhandenheits-Guard
        // ("Es existiert bereits eine Datenbank..."), aber ohne verständliche
        // Erklärung, was passiert ist und was jetzt zu tun ist. Der
        // Wiederherstellungs-Code hilft hier NICHT: er entkapselt nur die in
        // der (fehlenden) keyfile.json abgelegte gewrappte DEK, ist also ohne
        // die Datei wertlos.
        crypto::KeyfileState::None if db_exists && !plaintext => {
            json!({
                "mode": "keyfileMissing",
                "autoLockMinutes": 5,
                "message": format!(
                    "Es wurde eine verschlüsselte Datenbank gefunden, aber die zugehörige \
                     Schlüsseldatei \"{}\" fehlt im Ordner \"{}\" (z. B. beim Kopieren vergessen \
                     oder nachträglich gelöscht). Ohne sie lässt sich die Datenbank nicht \
                     entsperren – der Wiederherstellungs-Code hilft hier NICHT, da die dafür \
                     nötigen Daten ausschließlich in dieser Schlüsseldatei liegen. Mögliche \
                     Optionen: (1) \"{}\" aus einer Sicherung (z. B. Backup des Datenordners) an \
                     genau diesen Ort zurücklegen und die App neu starten. (2) Ohne eine solche \
                     Sicherung: die Datei \"{}\" in einen anderen Ordner verschieben (sie bleibt \
                     dort als Sicherung erhalten, nichts wird gelöscht) und die App neu starten, \
                     um eine neue, leere Datenbank mit neuem Passwort einzurichten – anschließend \
                     lässt sich ein zuvor erstelltes JSON-Backup unter „Daten → Sicherung & \
                     Übertragung → Import\" wieder einspielen.",
                    crypto::KEYFILE_NAME,
                    dir.display(),
                    crypto::KEYFILE_NAME,
                    db_file.display()
                )
            })
        }
        _ => {
            if plaintext {
                json!({ "mode": "needsMigration", "autoLockMinutes": 5 })
            } else {
                json!({ "mode": "firstRun", "autoLockMinutes": 5 })
            }
        }
    }
}

#[tauri::command]
fn db_status(loc: State<'_, AppDbLocation>) -> JsonValue {
    compute_db_status(&loc.0.data_dir, &loc.0.db_file)
}

/// Erst-Einrichtung OHNE bestehende DB: neue, leere, verschlüsselte DB anlegen.
/// Gibt den Recovery-Code (Anzeigeform) zurück – nur hier einmalig.
#[tauri::command]
fn crypto_setup(
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
    password: String,
) -> Result<JsonValue, CryptoCmdError> {
    // Sofort in Zeroizing verpacken: der Klartext-Puffer lebt danach nur noch
    // hinter einem Typ, der beim Drop (Funktionsende) zuverlässig genullt wird,
    // statt als gewöhnlicher String im Heap liegen zu bleiben.
    let password = Zeroizing::new(password);
    crypto::validate_password_policy(&password).map_err(db_err)?;
    let dir = data_dir(&loc);
    // Schutz: niemals ein vorhandenes Keyfile/DB überschreiben – das würde die
    // einzige gekapselte DEK vernichten und die DB unwiederbringlich machen.
    // Erst-Einrichtung greift nur auf "leerem" Stand (kein Keyfile, keine DB).
    if !matches!(crypto::classify_keyfile(&dir), crypto::KeyfileState::None)
        || loc.0.db_file.exists()
    {
        return Err(db_err("Es existiert bereits eine Datenbank oder Schlüsseldatei."));
    }
    let dek = crypto::gen_dek();
    let recovery = crypto::gen_recovery_canonical();
    let kf = crypto::build_keyfile(&dek, &password, &recovery, 5).map_err(db_err)?;
    crypto::write_keyfile_atomic(&dir, &kf).map_err(db_err)?;
    let conn = open_keyed(&loc.0.db_file, &dek)?;
    *state.lock().map_err(|e| db_err(e.to_string()))? = Some(KeyedConn { conn, dek });
    Ok(json!({ "recoveryCode": crypto::format_recovery(&recovery) }))
}

/// Entsperren mit Passwort ODER Recovery-Code. kind = "password" | "recovery".
#[tauri::command]
fn crypto_unlock(
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
    secret: String,
    kind: String,
) -> Result<(), CryptoCmdError> {
    let secret = Zeroizing::new(secret);
    let kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden.")),
    };
    let dek = if kind == "recovery" {
        // normalize_recovery liefert bewusst weiter einen plain String (reine,
        // Tauri-freie Funktion, s. crypto.rs) -> hier sofort zeroizen, statt den
        // normalisierten Code unkontrolliert im Heap liegen zu lassen.
        let norm = Zeroizing::new(crypto::normalize_recovery(&secret));
        crypto::unwrap_with_recovery(&kf, &norm)?
    } else {
        crypto::unwrap_with_password(&kf, &secret)?
    };
    let conn = open_keyed(&loc.0.db_file, &dek)?;
    *state.lock().map_err(|e| db_err(e.to_string()))? = Some(KeyedConn { conn, dek });
    Ok(())
}

/// Sperren: Connection droppen (SQLCipher-Schlüssel raus) + DEK zeroizen.
#[tauri::command]
fn crypto_lock(state: State<'_, DbState>) -> Result<(), String> {
    *state.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Passwort ändern: DEK mit altem Passwort entkapseln, mit neuem neu kapseln.
/// Kein Re-Encrypt der DB. Recovery-Code bleibt gültig.
#[tauri::command]
fn crypto_change_password(
    loc: State<'_, AppDbLocation>,
    old_password: String,
    new_password: String,
) -> Result<(), CryptoCmdError> {
    let old_password = Zeroizing::new(old_password);
    let new_password = Zeroizing::new(new_password);
    crypto::validate_password_policy(&new_password).map_err(db_err)?;
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden.")),
    };
    let dek = crypto::unwrap_with_password(&kf, &old_password)?;
    crypto::rewrap_password(&mut kf, &dek, &new_password).map_err(db_err)?;
    crypto::write_keyfile_atomic(&loc.0.data_dir, &kf).map_err(db_err)?;
    Ok(())
}

/// Neuen Recovery-Code erzeugen (altes Passwort bestätigt Besitz). Der alte
/// Code wird ungültig. Gibt den neuen Code (Anzeigeform) zurück.
#[tauri::command]
fn crypto_regenerate_recovery(
    loc: State<'_, AppDbLocation>,
    password: String,
) -> Result<JsonValue, CryptoCmdError> {
    let password = Zeroizing::new(password);
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden.")),
    };
    let dek = crypto::unwrap_with_password(&kf, &password)?;
    let recovery = crypto::gen_recovery_canonical();
    crypto::rewrap_recovery(&mut kf, &dek, &recovery).map_err(db_err)?;
    crypto::write_keyfile_atomic(&loc.0.data_dir, &kf).map_err(db_err)?;
    Ok(json!({ "recoveryCode": crypto::format_recovery(&recovery) }))
}

/// Auto-Lock-Dauer (Minuten) in der Keyfile v2 setzen.
#[tauri::command]
fn crypto_set_autolock(
    loc: State<'_, AppDbLocation>,
    minutes: u32,
) -> Result<(), CryptoCmdError> {
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden.")),
    };
    kf.auto_lock_minutes = minutes.clamp(1, 120);
    crypto::write_keyfile_atomic(&loc.0.data_dir, &kf).map_err(db_err)
}

/// Klartext-Backup (.pre-encrypt.bak) nach bestätigter Migration löschen.
#[tauri::command]
fn delete_plaintext_backup(loc: State<'_, AppDbLocation>) -> Result<(), String> {
    let bak = loc.0.data_dir.join("br_zeiten.db.pre-encrypt.bak");
    if bak.exists() {
        std::fs::remove_file(&bak).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Automatisches Backup (Finding 5/24) ----------

/// Anzahl der rotierend behaltenen Backup-Stände (siehe db_backup/rotate_backups).
const BACKUP_KEEP_COUNT: usize = 5;

/// Findet für einen (sortierbaren) Zeitstempel einen freien Dateinamen im
/// Backup-Ordner: hängt bei Kollision (zwei Backups im selben Millisekunden-
/// Zeitfenster, z. B. automatisches Backup direkt gefolgt von einem manuellen
/// Klick auf "Jetzt sichern") einen laufenden Suffix an, statt VACUUM INTO an
/// eine bereits existierende Zieldatei scheitern zu lassen.
fn unique_backup_paths(dir: &Path, stamp: &str) -> (PathBuf, PathBuf) {
    let mut suffix = String::new();
    let mut n: u32 = 0;
    loop {
        let db_path = dir.join(format!("br_zeiten-{stamp}{suffix}.db"));
        if !db_path.exists() {
            let kf_path = dir.join(format!("keyfile-{stamp}{suffix}.json"));
            return (db_path, kf_path);
        }
        n += 1;
        suffix = format!("-{n}");
    }
}

/// Erstellt ein konsistentes, verschlüsseltes Backup (Datenbank + keyfile.json
/// zusammen -- ohne keyfile.json ist eine DB-Kopie wertlos) im Unterordner
/// `backups/` neben der Hauptdatenbank und rotiert danach auf die letzten
/// BACKUP_KEEP_COUNT Stände.
///
/// `stamp` ist ein vom Frontend vorformatierter, chronologisch sortierbarer
/// Zeitstempel (z. B. "20260702-143000-125") -- damit braucht Rust keine
/// Datums-/Kalenderlogik (keine neue Dependency wie chrono nötig).
///
/// VACUUM INTO läuft über die bereits offene, entsperrte Connection und
/// erzeugt dadurch eine konsistente, mit demselben Schlüssel verschlüsselte
/// Kopie -- das frühere WAL-Risiko einer reinen Datei-Kopie (siehe Audit-
/// Finding 5/6) entfällt strukturell, ein separater Checkpoint ist nicht
/// nötig. Ohne entsperrte DB (gesperrt) schlägt der Aufruf fehl, statt still
/// nichts zu tun -- der Aufrufer (client-seitig best-effort) entscheidet, wie
/// er mit dem Fehler umgeht.
#[tauri::command]
fn db_backup(
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
    stamp: String,
) -> Result<String, String> {
    if stamp.trim().is_empty()
        || !stamp.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Ungültiger Zeitstempel für das Backup".to_string());
    }
    let guard = state.lock().map_err(|e| e.to_string())?;
    let kc = guard.as_ref().ok_or_else(|| "DB gesperrt".to_string())?;

    let backups_dir = loc.0.data_dir.join("backups");
    std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;

    let (db_backup_file, keyfile_backup_file) = unique_backup_paths(&backups_dir, &stamp);

    // Einfaches Quoting reicht: der Pfad kommt aus unserem eigenen data_dir,
    // nicht aus Nutzereingabe; ' wird trotzdem defensiv escaped (Muster wie
    // beim ATTACH DATABASE in crypto_migrate oben).
    let target_sql = db_backup_file.to_string_lossy().replace('\'', "''");
    kc.conn
        .execute_batch(&format!("VACUUM INTO '{target_sql}';"))
        .map_err(|e| format!("Backup fehlgeschlagen: {e}"))?;

    let keyfile_src = loc.0.data_dir.join(crypto::KEYFILE_NAME);
    if let Err(e) = std::fs::copy(&keyfile_src, &keyfile_backup_file) {
        // Ohne keyfile.json ist die DB-Kopie nicht entschlüsselbar und damit
        // wertlos -> lieber gar kein Backup als ein trügerisch unvollständiges.
        let _ = std::fs::remove_file(&db_backup_file);
        return Err(format!("Sicherung der Schlüsseldatei fehlgeschlagen: {e}"));
    }

    rotate_backups(&backups_dir, BACKUP_KEEP_COUNT);

    Ok(db_backup_file.to_string_lossy().into_owned())
}

/// Behält nur die letzten `keep` Backup-Stände (DB + zugehörige Keyfile-Kopie)
/// im Ordner, sortiert am (sortierbaren) Zeitstempel im Dateinamen. Best-
/// effort: ein Lösch- oder Lesefehler bricht das gerade erstellte Backup NICHT
/// ab (Rotation ist Aufräumen, kein Teil der eigentlichen Sicherung).
fn rotate_backups(backups_dir: &Path, keep: usize) {
    let mut stamps: Vec<String> = match std::fs::read_dir(backups_dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                name.strip_prefix("br_zeiten-")
                    .and_then(|s| s.strip_suffix(".db"))
                    .map(|s| s.to_string())
            })
            .collect(),
        Err(_) => return,
    };
    stamps.sort();
    if stamps.len() <= keep {
        return;
    }
    for old in &stamps[..stamps.len() - keep] {
        let _ = std::fs::remove_file(backups_dir.join(format!("br_zeiten-{old}.db")));
        let _ = std::fs::remove_file(backups_dir.join(format!("keyfile-{old}.json")));
    }
}

fn count_table(conn: &Connection, table: &str) -> Result<i64, String> {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Einmalige Migration einer bestehenden KLARTEXT-DB in eine verschlüsselte.
/// `password` ist das (neue) Passwort, das die verschlüsselte DB schützt.
/// Daten-sicher: Klartext wird nie in-place geändert; .bak zuerst; verschlüsselte
/// Kopie + Zeilen-Verifikation; erst dann atomarer rename-Swap; .bak bleibt.
#[tauri::command]
fn crypto_migrate(
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
    password: String,
) -> Result<JsonValue, CryptoCmdError> {
    let password = Zeroizing::new(password);
    crypto::validate_password_policy(&password).map_err(db_err)?;
    let dir = data_dir(&loc);
    let db_file = loc.0.db_file.clone();
    if !is_plaintext_db(&db_file) {
        return Err(db_err("Keine Klartext-Datenbank zum Verschlüsseln gefunden"));
    }
    let bak = dir.join("br_zeiten.db.pre-encrypt.bak");
    let bak_tmp = dir.join("br_zeiten.db.pre-encrypt.bak.tmp");
    let tmp = dir.join("br_zeiten.db.enc.tmp");

    // 0) Aufräumen evtl. halber Vorläufe (verschlüsselte Kopie + Backup-Temp).
    // Eine unterbrochene Migration erkennt db_status an "V2-Keyfile + Klartext-DB"
    // und schickt erneut hierher -> idempotenter Neuanlauf.
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&bak_tmp);

    // 1) Klartext-Backup zuerst, ATOMAR (kopieren -> rename), nur falls noch keins da.
    if !bak.exists() {
        std::fs::copy(&db_file, &bak_tmp)
            .map_err(|e| db_err(format!("Backup fehlgeschlagen: {e}")))?;
        std::fs::rename(&bak_tmp, &bak)
            .map_err(|e| db_err(format!("Backup fehlgeschlagen: {e}")))?;
    }

    // 2) Schlüssel + Keyfile vorbereiten.
    let dek = crypto::gen_dek();
    let recovery = crypto::gen_recovery_canonical();
    let kf = crypto::build_keyfile(&dek, &password, &recovery, 5).map_err(db_err)?;

    // 3) Verschlüsselte Kopie via sqlcipher_export.
    let keylit = crypto::dek_pragma_literal(&dek);
    let tmp_sql = tmp.to_string_lossy().replace('\'', "''");
    {
        let src = Connection::open(&db_file).map_err(|e| db_err(e.to_string()))?;
        // Der DEK-Hex-Literal landet hier eingebettet in einem SQL-String; ohne
        // Zeroizing würde diese Kopie des Schlüsselmaterials als gewöhnlicher
        // String im Heap zurückbleiben, statt beim Drop genullt zu werden.
        let attach_sql = Zeroizing::new(format!(
            "ATTACH DATABASE '{}' AS enc KEY \"{}\";",
            tmp_sql, &*keylit
        ));
        src.execute_batch(&attach_sql)
            .map_err(|e| db_err(format!("ATTACH: {e}")))?;
        src.query_row("SELECT sqlcipher_export('enc')", [], |_| Ok(()))
            .map_err(|e| db_err(format!("Export: {e}")))?;
        src.execute_batch("DETACH DATABASE enc;")
            .map_err(|e| db_err(format!("DETACH: {e}")))?;
    }

    // 4) Verifizieren: verschlüsselte Kopie öffnen, Zeilenzahlen je Tabelle.
    {
        let enc = open_keyed(&tmp, &dek)?;
        let src = Connection::open(&db_file).map_err(|e| db_err(e.to_string()))?;
        for t in ["entries", "task_tags", "entry_tags", "objections"] {
            let a = count_table(&src, t).map_err(db_err)?;
            let b = count_table(&enc, t).map_err(db_err)?;
            if a != b {
                let _ = std::fs::remove_file(&tmp);
                return Err(db_err(format!(
                    "Verifikation fehlgeschlagen ({t}: {a} != {b}) – Klartext unverändert"
                )));
            }
        }
    }

    // 5) Keyfile v2 atomar schreiben (VOR dem Swap).
    crypto::write_keyfile_atomic(&dir, &kf).map_err(db_err)?;

    // 6) Atomarer Swap: verschlüsselte Kopie ersetzt die Klartext-DB.
    // Ab hier ist die DB verschlüsselt; ein Crash vor Schritt 8 ist unkritisch,
    // da db_status dann "V2-Keyfile + verschlüsselte DB" = encrypted erkennt.
    std::fs::rename(&tmp, &db_file).map_err(|e| db_err(format!("Swap fehlgeschlagen: {e}")))?;

    // 7) (.bak bleibt bis zur Nutzerbestätigung erhalten.)
    // 8) Entsperrt öffnen.
    let conn = open_keyed(&db_file, &dek)?;
    *state.lock().map_err(|e| db_err(e.to_string()))? = Some(KeyedConn { conn, dek });
    Ok(json!({ "recoveryCode": crypto::format_recovery(&recovery) }))
}

// ---------- Biometrie-Entsperren (Issue #2, B-Core) ----------
//
// Dritter DEK-Wrap ("bio") neben pw/rc: die DEK wird von einem AES-256-GCM-
// Schlüssel im Android-Keystore gekapselt (auth-required, CryptoObject-gebunden).
// KEIN gespeichertes Passwort, KEIN Klartext-Schlüssel auf Platte. Die eigentliche
// Krypto passiert im Kotlin-Plugin nach erfolgreichem BiometricPrompt; Rust
// verifiziert das Passwort (Enroll), transportiert Base64 und pflegt den bio-Wrap
// im keyfile.
//
// Alle Commands sind für ALLE Plattformen registriert (das Frontend ruft
// plattformagnostisch), aber android-gegated: auf Desktop liefern die Arme einen
// klaren deutschen Fehler bzw. "nicht verfügbar".

/// Strukturierter bio_unlock-Fehler für die UI-Welle. `kind` erlaubt gezielte
/// Reaktion: KEY_INVALIDATED -> auf Passwort zurückfallen und Re-Aktivierung
/// anbieten; Canceled -> stiller Abbruch; Lockout/Unavailable -> Hinweis.
#[allow(dead_code)] // Desktop-Arm konstruiert nur `Unavailable`; Rest ist Android.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum BioCmdError {
    /// bio-Wrap wurde entfernt (Key ungültig, z. B. neuer Finger registriert).
    KeyInvalidated { message: String },
    /// Nutzer hat den BiometricPrompt abgebrochen.
    Canceled { message: String },
    /// Zu viele Fehlversuche (Android-Lockout).
    Lockout { message: String },
    /// Biometrie nicht verfügbar / nicht aktiviert.
    Unavailable { message: String },
    /// Sonstiges (DB-/Keyfile-/unerwarteter Fehler).
    Other { message: String },
}

/// bio_status: liest, ob im keyfile ein bio-Wrap hinterlegt ist. Plattform-
/// unabhängig (reine Dateilogik) – die UI zeigt darüber "aktiviert/deaktiviert".
#[tauri::command]
fn bio_status(loc: State<'_, AppDbLocation>) -> JsonValue {
    let enrolled = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => crypto::has_bio_wrap(&kf),
        _ => false,
    };
    json!({ "enrolled": enrolled })
}

// --- Android-Arme ---

/// Übersetzt einen Plugin-Fehlercode in eine deutsche Meldung (Enroll/Disable).
#[cfg(target_os = "android")]
fn bio_plugin_message(e: &tauri_plugin_biometric_unlock::Error) -> String {
    use tauri_plugin_biometric_unlock::code;
    match e.code() {
        Some(code::USER_CANCELED) => "Vorgang abgebrochen.".to_string(),
        Some(code::LOCKOUT) => {
            "Zu viele Fehlversuche. Bitte später erneut versuchen oder das Passwort verwenden."
                .to_string()
        }
        Some(code::NO_BIOMETRICS) => "Keine Biometrie verfügbar oder registriert.".to_string(),
        Some(code::KEY_INVALIDATED) => "Der Fingerabdruck-Schlüssel ist ungültig.".to_string(),
        _ => e.message(),
    }
}

/// bio_available: fragt den Android-Keystore/BiometricManager (BIOMETRIC_STRONG).
#[cfg(target_os = "android")]
#[tauri::command]
fn bio_available(app: tauri::AppHandle) -> JsonValue {
    use tauri_plugin_biometric_unlock::BiometricUnlockExt;
    match app.biometric_unlock().is_available() {
        Ok(r) => json!({ "available": r.available, "reason": r.reason }),
        Err(e) => json!({ "available": false, "reason": e.message() }),
    }
}

/// bio_enable: verifiziert das Passwort (entkapselt die DEK wie crypto_unlock),
/// lässt den Keystore die DEK kapseln und speichert den bio-Wrap ins keyfile.
#[cfg(target_os = "android")]
#[tauri::command]
fn bio_enable(
    app: tauri::AppHandle,
    loc: State<'_, AppDbLocation>,
    password: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use tauri_plugin_biometric_unlock::BiometricUnlockExt;

    let password = Zeroizing::new(password);
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(format!("Schlüsseldatei beschädigt: {m}")),
        _ => return Err("Keine verschlüsselte Datenbank vorhanden.".to_string()),
    };
    // Passwort verifizieren = DEK entkapseln.
    let dek = crypto::unwrap_with_password(&kf, &password).map_err(|e| match e {
        crypto::UnwrapError::WrongSecret => "Falsches Passwort.".to_string(),
        crypto::UnwrapError::Corrupt(m) => format!("Schlüsseldatei beschädigt: {m}"),
    })?;
    // DEK Base64-kodiert an den Keystore übergeben. Unsere Kopie liegt in
    // Zeroizing; die serde/JNI-Serialisierung erzeugt eine weitere, nicht
    // kontrollierbare (kurzlebige) Kopie -- best effort, hier dokumentiert.
    let dek_b64 = Zeroizing::new(STANDARD.encode(&dek[..]));
    let resp = app
        .biometric_unlock()
        .enroll((*dek_b64).clone())
        .map_err(|e| bio_plugin_message(&e))?;
    crypto::set_bio_wrap(&mut kf, resp.ciphertext_b64, resp.iv_b64);
    crypto::write_keyfile_atomic(&loc.0.data_dir, &kf)?;
    Ok(())
}

/// bio_unlock: liest den bio-Wrap, lässt den Keystore die DEK per BiometricPrompt
/// entschlüsseln und öffnet die DB über denselben Pfad wie crypto_unlock. Bei
/// KEY_INVALIDATED wird der bio-Wrap aus dem keyfile entfernt.
#[cfg(target_os = "android")]
#[tauri::command]
fn bio_unlock(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
) -> Result<(), BioCmdError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use tauri_plugin_biometric_unlock::{code, BiometricUnlockExt};

    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => {
            return Err(BioCmdError::Other { message: format!("Schlüsseldatei beschädigt: {m}") })
        }
        _ => {
            return Err(BioCmdError::Other {
                message: "Keine verschlüsselte Datenbank vorhanden.".to_string(),
            })
        }
    };
    let bio = match &kf.bio {
        Some(b) => b.clone(),
        None => {
            return Err(BioCmdError::Unavailable {
                message: "Fingerabdruck-Entsperren ist nicht aktiviert.".to_string(),
            })
        }
    };

    let resp = match app.biometric_unlock().authenticate(bio.ciphertext, bio.iv) {
        Ok(r) => r,
        Err(e) => {
            return Err(match e.code() {
                Some(code::KEY_INVALIDATED) => {
                    // bio-Wrap ist wertlos -> aus dem keyfile entfernen. App fällt
                    // auf Passwort zurück; Re-Aktivierung ist Sache der UI.
                    crypto::clear_bio_wrap(&mut kf);
                    let _ = crypto::write_keyfile_atomic(&loc.0.data_dir, &kf);
                    BioCmdError::KeyInvalidated {
                        message: "Fingerabdruck-Anmeldung ungültig – bitte Passwort verwenden und neu aktivieren.".to_string(),
                    }
                }
                Some(code::USER_CANCELED) => {
                    BioCmdError::Canceled { message: "Vorgang abgebrochen.".to_string() }
                }
                Some(code::LOCKOUT) => BioCmdError::Lockout {
                    message: "Zu viele Fehlversuche. Bitte Passwort verwenden.".to_string(),
                },
                Some(code::NO_BIOMETRICS) => BioCmdError::Unavailable {
                    message: "Keine Biometrie verfügbar oder registriert.".to_string(),
                },
                _ => BioCmdError::Other { message: e.message() },
            });
        }
    };

    // DEK aus Base64 dekodieren, durchgängig in Zeroizing halten.
    let dek_b64 = Zeroizing::new(resp.dek_b64);
    let dek_bytes = Zeroizing::new(STANDARD.decode(dek_b64.as_bytes()).map_err(|e| {
        BioCmdError::Other { message: format!("Ungültige Schlüsseldaten vom Keystore: {e}") }
    })?);
    if dek_bytes.len() != 32 {
        return Err(BioCmdError::Other {
            message: "Unerwartete Schlüssellänge vom Keystore.".to_string(),
        });
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&dek_bytes);

    // Ab hier identisch zu crypto_unlock: DB öffnen + AppState setzen.
    let conn = open_keyed(&loc.0.db_file, &dek).map_err(|e| BioCmdError::Other {
        message: match e {
            CryptoCmdError::WrongSecret => {
                "Der Fingerabdruck-Schlüssel passt nicht zur Datenbank.".to_string()
            }
            CryptoCmdError::Corrupt { message } => format!("Beschädigt: {message}"),
            CryptoCmdError::DbError { message } => message,
        },
    })?;
    *state
        .lock()
        .map_err(|e| BioCmdError::Other { message: e.to_string() })? =
        Some(KeyedConn { conn, dek });
    Ok(())
}

/// bio_disable: löscht den Keystore-Key UND entfernt den bio-Wrap aus dem keyfile.
#[cfg(target_os = "android")]
#[tauri::command]
fn bio_disable(app: tauri::AppHandle, loc: State<'_, AppDbLocation>) -> Result<(), String> {
    use tauri_plugin_biometric_unlock::BiometricUnlockExt;

    app.biometric_unlock()
        .remove_key()
        .map_err(|e| bio_plugin_message(&e))?;
    if let crypto::KeyfileState::V2(mut kf) = crypto::classify_keyfile(&loc.0.data_dir) {
        if crypto::has_bio_wrap(&kf) {
            crypto::clear_bio_wrap(&mut kf);
            crypto::write_keyfile_atomic(&loc.0.data_dir, &kf)?;
        }
    }
    Ok(())
}

// --- Desktop-Stubs (identische Command-Namen, klarer Fehler) ---

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn bio_available() -> JsonValue {
    json!({
        "available": false,
        "reason": "Fingerabdruck-Entsperren ist nur unter Android verfügbar."
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn bio_enable(_password: String) -> Result<(), String> {
    Err("Fingerabdruck-Entsperren ist nur unter Android verfügbar.".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn bio_unlock() -> Result<(), BioCmdError> {
    Err(BioCmdError::Unavailable {
        message: "Fingerabdruck-Entsperren ist nur unter Android verfügbar.".to_string(),
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn bio_disable() -> Result<(), String> {
    Err("Fingerabdruck-Entsperren ist nur unter Android verfügbar.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Schema idempotent im Frontend (schema.ts). KEINE prüfsummen-Migrationen.
    let mut builder = tauri::Builder::default();
    // Single-Instance MUSS als erstes Plugin registriert werden (Doku-Vorgabe).
    // Desktop-only: verhindert zwei parallele Fenster auf derselben SQLite-DB
    // (sonst sehen sich beide Instanzen gegenseitig nicht -> Last-Write-Wins).
    // Zweitstart fokussiert einfach das bestehende Hauptfenster.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                // show(): das Fenster kann im Tray-Betrieb versteckt sein --
                // ein Zweitstart soll es dann sichtbar machen, nicht nur
                // fokussieren.
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
        // Autostart (opt-in, Einstellungen): zusammen mit close_to_tray läuft
        // die App damit ab Anmeldung im Hintergrund -> Erinnerungen feuern.
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }
    // Android-Portierung (A-Core): Storage-Access-Framework-Plugin nur auf
    // Android registrieren -- braucht der echte Android-Arm der drei
    // file_io.rs-Commands (export_text_file/export_binary_file/
    // import_text_file, siehe file_io.rs `mod android`).
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_android_fs::init());
        // Biometrie-Entsperren (Issue #2, B-Core): projektinternes Plugin mit
        // Kotlin-Teil (Android-Keystore + BiometricPrompt). Bridge für die
        // bio_*-Commands unten; die eigentliche Krypto liegt im Keystore.
        builder = builder.plugin(tauri_plugin_biometric_unlock::init());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // DB wird NICHT mehr beim Start geöffnet (Schlüssel liegt erst nach
            // dem Entsperren vor). Nur Pfad/Modus ermitteln und State anlegen.
            let loc = match app.path().app_config_dir() {
                Ok(cfg_dir) => db_location::resolve(cfg_dir),
                Err(_) => DbLocation {
                    db_file: PathBuf::new(),
                    data_dir: PathBuf::new(),
                    portable: false,
                },
            };
            app.manage(AppDbLocation(loc));
            app.manage::<DbState>(Mutex::new(None));
            // System-Tray (Desktop): Voraussetzung für close_to_tray.
            #[cfg(desktop)]
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Desktop + aktivierte Einstellung: Fenster-Schließen versteckt ins
            // Tray statt zu beenden (Erinnerungen laufen weiter). "Beenden"
            // im Tray-Menü geht über app.exit() an diesem Handler vorbei.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                if _window.label() == "main"
                    && app_settings::load(_window.app_handle()).close_to_tray
                {
                    let _ = _window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_settings::app_settings_get,
            app_settings::app_settings_set,
            file_io::export_text_file,
            file_io::export_binary_file,
            file_io::import_text_file,
            db_execute,
            db_select,
            db_batch,
            db_migrate,
            db_path,
            db_status,
            crypto_setup,
            crypto_unlock,
            crypto_lock,
            crypto_change_password,
            crypto_regenerate_recovery,
            crypto_set_autolock,
            crypto_migrate,
            delete_plaintext_backup,
            db_backup,
            bio_status,
            bio_available,
            bio_enable,
            bio_unlock,
            bio_disable
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Tauri-Anwendung");
}

// ---------- Tests: Schema-Migration (Tauri-frei, reine rusqlite-Connection) ----------

#[cfg(test)]
mod migration_tests {
    use super::{run_migrations, MIGRATE_V1_SQL, MIGRATE_V2_SQL, SCHEMA_VERSION};
    use rusqlite::Connection;

    /// v0-Basisschema (Stand v1.2.0), wie es das Frontend via schema.ts anlegt.
    /// Bewusst eingefroren: künftige Änderungen laufen über nummerierte Migrationen.
    const V0_SCHEMA: &str = r#"
        CREATE TABLE entries (
          id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT, end_time TEXT,
          duration_minutes INTEGER NOT NULL DEFAULT 0, info_for_management TEXT NOT NULL DEFAULT '',
          secret_details TEXT NOT NULL DEFAULT '', had_planned_shift INTEGER NOT NULL DEFAULT 1,
          shift_compensation_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_entries_date ON entries(date);
        CREATE TABLE task_tags (id TEXT PRIMARY KEY, label TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE entry_tags (entry_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (entry_id, tag_id));
        CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);
        CREATE TABLE objections (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
          by_whom TEXT NOT NULL DEFAULT '', date TEXT);
        CREATE INDEX idx_objections_entry ON objections(entry_id);
    "#;

    fn seed_v0(conn: &Connection) {
        conn.execute_batch(V0_SCHEMA).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO entries (id,date,duration_minutes,info_for_management,created_at,updated_at)
              VALUES ('e1','2026-01-01',60,'Info 1','t','t'),
                     ('e2','2026-01-02',30,'Info 2','t','t');
            INSERT INTO entries (id,date,duration_minutes,info_for_management,created_at,updated_at)
              VALUES (NULL,'2026-01-03',15,'Info NULL','t','t');
            INSERT INTO task_tags (id,label,archived) VALUES
              ('a1','Fahrzeit',0), ('a2','fahrzeit',0), ('b1','Sitzung',0);
            INSERT INTO entry_tags (entry_id,tag_id) VALUES
              ('e1','a1'), ('e1','a2'), ('e1','b1'), ('e2','a2');
            INSERT INTO objections (id,entry_id,reason,by_whom,date) VALUES
              ('o1','e1','Grund','GL',NULL);
        "#,
        )
        .unwrap();
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn migriert_v0_auf_v1_vollstaendig() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);

        let v = run_migrations(&mut conn).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        // run_migrations läuft von v0 immer bis zur höchsten bekannten Version
        // durch (aktuell 2, inkl. Migration 2/pause_minutes) -- SCHEMA_VERSION
        // statt eines hartkodierten Literals hält diese Zeile wartungsfrei,
        // falls künftig weitere Migrationen dazukommen.
        assert_eq!(count(&conn, "PRAGMA user_version"), SCHEMA_VERSION);

        // NULL-id-Zeile verworfen.
        assert_eq!(count(&conn, "SELECT count(*) FROM entries"), 2);
        // Case-insensitive Duplikat-Tag (Fahrzeit/fahrzeit) gemergt.
        assert_eq!(count(&conn, "SELECT count(*) FROM task_tags"), 2);
        // e1: a2 auf Überlebenden a1 umgehängt, DISTINCT -> {a1,b1}.
        assert_eq!(count(&conn, "SELECT count(*) FROM entry_tags WHERE entry_id='e1'"), 2);
        assert_eq!(count(&conn, "SELECT count(*) FROM entry_tags WHERE entry_id='e1' AND tag_id='a1'"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM entry_tags WHERE entry_id='e1' AND tag_id='b1'"), 1);
        // e2: a2 -> a1.
        assert_eq!(count(&conn, "SELECT count(*) FROM entry_tags WHERE entry_id='e2' AND tag_id='a1'"), 1);
        // Neue Spalte is_compensation, Default 0.
        assert_eq!(count(&conn, "SELECT is_compensation FROM entries WHERE id='e1'"), 0);
        // Objection erhalten.
        assert_eq!(count(&conn, "SELECT count(*) FROM objections WHERE entry_id='e1'"), 1);
    }

    #[test]
    fn check_unique_und_fk_aktiv_nach_migration() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();

        // CHECK(duration_minutes >= 0) lehnt Negativwerte ab.
        assert!(conn
            .execute(
                "INSERT INTO entries (id,date,duration_minutes,created_at,updated_at) VALUES ('x','2026-01-01',-1,'t','t')",
                [],
            )
            .is_err());

        // Erlaubt: ohne Start/Ende mit Dauer > 0 (kein Zeit-CHECK).
        conn.execute(
            "INSERT INTO entries (id,date,start_time,end_time,duration_minutes,created_at,updated_at) VALUES ('ok1','2026-01-01',NULL,NULL,120,'t','t')",
            [],
        )
        .unwrap();

        // UNIQUE(label COLLATE NOCASE) lehnt case-insensitive Duplikate ab.
        assert!(conn
            .execute("INSERT INTO task_tags (id,label,archived) VALUES ('z','FAHRZEIT',0)", [])
            .is_err());

        // FK ON DELETE CASCADE: Löschen eines Eintrags entfernt Kindzeilen.
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute("DELETE FROM entries WHERE id='e1'", []).unwrap();
        assert_eq!(count(&conn, "SELECT count(*) FROM entry_tags WHERE entry_id='e1'"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM objections WHERE entry_id='e1'"), 0);
    }

    #[test]
    fn migration_ist_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();
        let v = run_migrations(&mut conn).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert_eq!(count(&conn, "SELECT count(*) FROM entries"), 2);
        assert_eq!(count(&conn, "SELECT count(*) FROM task_tags"), 2);
    }

    #[test]
    fn downgrade_wird_abgelehnt() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        // Ein user_version-Stand JENSEITS der vom Code unterstützten Version
        // (SCHEMA_VERSION + 1) simuliert eine mit einer neueren App-Version
        // erzeugte DB -- unabhängig davon, auf welchem Stand SCHEMA_VERSION
        // gerade steht.
        conn.execute_batch(&format!("PRAGMA user_version={};", SCHEMA_VERSION + 1))
            .unwrap();
        assert!(run_migrations(&mut conn).is_err());
    }

    // ---------- Migration 2: pause_minutes (additives ALTER TABLE ADD COLUMN) ----------

    #[test]
    fn migriert_v1_auf_v2_pause_minutes_additiv_mit_default_0() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        // Simuliert eine reale Bestands-DB, die bereits auf v1 migriert wurde,
        // BEVOR es Migration 2 (pause_minutes) gab -- nicht über run_migrations
        // (das würde in einem Rutsch bis zur aktuellen SCHEMA_VERSION laufen),
        // sondern durch direktes Anwenden von genau MIGRATE_V1_SQL + Stempeln
        // auf user_version=1.
        conn.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
        conn.execute_batch(MIGRATE_V1_SQL).unwrap();
        conn.execute_batch("PRAGMA user_version=1; PRAGMA foreign_keys=ON;")
            .unwrap();
        assert_eq!(count(&conn, "PRAGMA user_version"), 1);

        let v = run_migrations(&mut conn).unwrap();

        assert_eq!(v, SCHEMA_VERSION);
        // run_migrations läuft von v1 bis zur höchsten bekannten Version durch
        // (nicht nur bis 2) -- SCHEMA_VERSION statt Literal, wie im v0-Test.
        assert_eq!(count(&conn, "PRAGMA user_version"), SCHEMA_VERSION);
        // Bestandsdaten (aus seed_v0/Migration 1) bleiben unangetastet.
        assert_eq!(count(&conn, "SELECT count(*) FROM entries"), 2);
        assert_eq!(
            count(&conn, "SELECT duration_minutes FROM entries WHERE id='e1'"),
            60
        );
        // Neue Spalte pause_minutes: Default 0 für alle Bestandszeilen.
        assert_eq!(
            count(&conn, "SELECT pause_minutes FROM entries WHERE id='e1'"),
            0
        );
        assert_eq!(
            count(&conn, "SELECT pause_minutes FROM entries WHERE id='e2'"),
            0
        );
    }

    #[test]
    fn check_pause_minutes_lehnt_negativwerte_ab_bei_insert_und_update() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();

        // CHECK(pause_minutes >= 0) lehnt einen negativen Wert beim INSERT ab.
        assert!(conn
            .execute(
                "INSERT INTO entries (id,date,duration_minutes,pause_minutes,created_at,updated_at) VALUES ('x','2026-01-01',60,-1,'t','t')",
                [],
            )
            .is_err());

        // ... und ebenso beim UPDATE einer Bestandszeile (Default 0 aus der
        // Migration ist selbst kein Verstoß, ein nachträglicher negativer
        // Wert wird trotzdem abgelehnt).
        assert!(conn
            .execute("UPDATE entries SET pause_minutes = -5 WHERE id='e1'", [])
            .is_err());

        // Positive Werte bleiben uneingeschränkt erlaubt.
        conn.execute("UPDATE entries SET pause_minutes = 15 WHERE id='e1'", [])
            .unwrap();
        assert_eq!(
            count(&conn, "SELECT pause_minutes FROM entries WHERE id='e1'"),
            15
        );
    }

    // ---------- Migration 3: Terminkalender (vier neue Tabellen, additiv) ----------

    /// Legt einen gültigen zeitgebundenen Einzeltermin an (Minimal-Helfer der
    /// Termin-Tests; Varianten setzen die Spalten per UPDATE bzw. eigenem INSERT).
    fn insert_appointment(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,created_at,updated_at)
             VALUES (?1,'Sitzung','2026-07-20','09:00','2026-07-20','11:00','t','t')",
            [id],
        )
        .unwrap();
    }

    #[test]
    fn migriert_v2_auf_v3_termin_tabellen_additiv() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        // Simuliert eine reale Bestands-DB auf v2 (BEVOR es Migration 3 gab):
        // exakt MIGRATE_V1_SQL + MIGRATE_V2_SQL anwenden + auf 2 stempeln --
        // nicht run_migrations, das liefe in einem Rutsch bis zur aktuellen
        // SCHEMA_VERSION (Muster des v1-auf-v2-Tests).
        conn.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
        conn.execute_batch(MIGRATE_V1_SQL).unwrap();
        conn.execute_batch(MIGRATE_V2_SQL).unwrap();
        conn.execute_batch("PRAGMA user_version=2; PRAGMA foreign_keys=ON;")
            .unwrap();

        let v = run_migrations(&mut conn).unwrap();

        assert_eq!(v, SCHEMA_VERSION);
        // run_migrations läuft von v2 bis zur höchsten bekannten Version durch
        // (nicht nur bis 3) -- SCHEMA_VERSION statt Literal, wie in den
        // Nachbar-Tests der Migrationen 1/2.
        assert_eq!(count(&conn, "PRAGMA user_version"), SCHEMA_VERSION);
        // Neue Tabellen existieren und sind leer.
        assert_eq!(count(&conn, "SELECT count(*) FROM appointments"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM appointment_tags"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM appointment_reminders"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM reminder_fired"), 0);
        // Bestandsdaten bleiben unangetastet.
        assert_eq!(count(&conn, "SELECT count(*) FROM entries"), 2);
        assert_eq!(count(&conn, "SELECT count(*) FROM task_tags"), 2);
    }

    #[test]
    fn check_constraints_der_termin_tabelle() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();

        // Gültig: zeitgebundener Einzeltermin.
        insert_appointment(&conn, "t1");
        // Gültig: ganztägig ohne Uhrzeiten, mehrtägig.
        conn.execute(
            "INSERT INTO appointments (id,title,is_all_day,start_date,end_date,created_at,updated_at)
             VALUES ('t2','Seminar',1,'2026-07-21','2026-07-23','t','t')",
            [],
        )
        .unwrap();

        // Ganztägig MIT Uhrzeit -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,is_all_day,start_date,start_time,end_date,end_time,created_at,updated_at)
                 VALUES ('x1','Kaputt',1,'2026-07-21','09:00','2026-07-21','10:00','t','t')",
                [],
            )
            .is_err());
        // Zeitgebunden OHNE Uhrzeiten -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,start_date,end_date,created_at,updated_at)
                 VALUES ('x2','Kaputt','2026-07-21','2026-07-21','t','t')",
                [],
            )
            .is_err());
        // Ende vor Start -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,created_at,updated_at)
                 VALUES ('x3','Kaputt','2026-07-22','09:00','2026-07-21','10:00','t','t')",
                [],
            )
            .is_err());
        // Override ohne recurrence_anchor -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,created_at,updated_at)
                 VALUES ('x4','Kaputt','2026-07-22','09:00','2026-07-22','10:00','t1','t','t')",
                [],
            )
            .is_err());
        // Override, der selbst eine Serie wäre (rrule gesetzt) -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,recurrence_anchor,rrule,created_at,updated_at)
                 VALUES ('x5','Kaputt','2026-07-22','09:00','2026-07-22','10:00','t1','2026-07-22','FREQ=DAILY','t','t')",
                [],
            )
            .is_err());
        // Negativer Erinnerungs-Vorlauf -> CHECK-Verstoß.
        assert!(conn
            .execute(
                "INSERT INTO appointment_reminders (id,appointment_id,minutes_before) VALUES ('r-neg','t1',-5)",
                [],
            )
            .is_err());
    }

    #[test]
    fn override_eindeutigkeit_pro_serie_und_anker() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();

        // Serie + erster Override auf den 22.07.
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,rrule,created_at,updated_at)
             VALUES ('s1','Wöchentlich','2026-07-15','09:00','2026-07-15','10:00','FREQ=WEEKLY','t','t')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,recurrence_anchor,created_at,updated_at)
             VALUES ('o1','Verschoben','2026-07-23','11:00','2026-07-23','12:00','s1','2026-07-22','t','t')",
            [],
        )
        .unwrap();
        // Zweiter Override auf DENSELBEN Anker -> UNIQUE-Index lehnt ab.
        assert!(conn
            .execute(
                "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,recurrence_anchor,created_at,updated_at)
                 VALUES ('o2','Doppelt','2026-07-24','11:00','2026-07-24','12:00','s1','2026-07-22','t','t')",
                [],
            )
            .is_err());
        // Anderer Anker derselben Serie bleibt erlaubt.
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,recurrence_anchor,created_at,updated_at)
             VALUES ('o3','Ok','2026-07-30','11:00','2026-07-30','12:00','s1','2026-07-29','t','t')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn cascade_kette_der_termin_tabellen() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        // Master mit Override, Tag-Zuordnung, Erinnerung und Feuer-Protokoll.
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,rrule,created_at,updated_at)
             VALUES ('m1','Serie','2026-07-15','09:00','2026-07-15','10:00','FREQ=WEEKLY','t','t')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO appointments (id,title,start_date,start_time,end_date,end_time,parent_id,recurrence_anchor,created_at,updated_at)
             VALUES ('ov1','Override','2026-07-23','11:00','2026-07-23','12:00','m1','2026-07-22','t','t')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO appointment_tags (appointment_id,tag_id) VALUES ('m1','a1')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO appointment_reminders (id,appointment_id,minutes_before) VALUES ('r1','m1',15)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reminder_fired (appointment_id,reminder_id,occurrence_anchor,fired_at)
             VALUES ('m1','r1','2026-07-15','t')",
            [],
        )
        .unwrap();

        // Löschen des Masters räumt die gesamte Kette ab (Override via
        // parent_id-FK, Tags/Reminders direkt, reminder_fired über beide FKs).
        conn.execute("DELETE FROM appointments WHERE id='m1'", []).unwrap();
        assert_eq!(count(&conn, "SELECT count(*) FROM appointments"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM appointment_tags"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM appointment_reminders"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM reminder_fired"), 0);

        // Kaskade in der Gegenrichtung: Löschen NUR einer Erinnerung räumt
        // deren Feuer-Protokoll ab, lässt den Termin aber stehen.
        insert_appointment(&conn, "t9");
        conn.execute(
            "INSERT INTO appointment_reminders (id,appointment_id,minutes_before) VALUES ('r9','t9',30)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reminder_fired (appointment_id,reminder_id,occurrence_anchor,fired_at)
             VALUES ('t9','r9','2026-07-20','t')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM appointment_reminders WHERE id='r9'", [])
            .unwrap();
        assert_eq!(count(&conn, "SELECT count(*) FROM reminder_fired"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM appointments WHERE id='t9'"), 1);
    }

    // ---------- Migration 4: abgeleitete Spalte series_end_date (additiv) ----------

    #[test]
    fn migration_v4_fuegt_series_end_date_hinzu() {
        let mut conn = Connection::open_in_memory().unwrap();
        seed_v0(&conn);
        run_migrations(&mut conn).unwrap();
        // Spalte existiert und ist beschreibbar (NULL-Default für Bestand).
        conn.execute_batch(
            "INSERT INTO appointments (id, start_date, end_date, is_all_day, start_time, end_time, exdates, created_at, updated_at)
             VALUES ('a1','2026-01-01','2026-01-01',1,NULL,NULL,'[]','x','x');",
        )
        .unwrap();
        let v: Option<String> = conn
            .query_row("SELECT series_end_date FROM appointments WHERE id='a1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, None);
        conn.execute("UPDATE appointments SET series_end_date='2026-03-31' WHERE id='a1'", [])
            .unwrap();
    }
}

// ---------- Tests: db_status-Logik (reine Pfad-/Dateilogik, kein echtes SQLCipher) ----------

#[cfg(test)]
mod db_status_tests {
    use super::compute_db_status;
    use crate::crypto;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Eindeutiges, isoliertes Verzeichnis unter dem System-Temp-Ordner.
    fn temp_test_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "br-log-dbstatus-test-{label}-{}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("Temp-Testverzeichnis anlegen");
        dir
    }

    #[test]
    fn firstrun_wenn_weder_db_noch_keyfile_existieren() {
        let dir = temp_test_dir("firstrun");
        let db_file = dir.join("br_zeiten.db");

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "firstRun");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn needs_migration_wenn_klartext_db_ohne_keyfile() {
        let dir = temp_test_dir("plain-no-keyfile");
        let db_file = dir.join("br_zeiten.db");
        std::fs::write(&db_file, b"SQLite format 3\0Rest der Datei irrelevant").unwrap();

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "needsMigration");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn encrypted_wenn_v2_keyfile_und_verschluesselte_db() {
        let dir = temp_test_dir("encrypted");
        let db_file = dir.join("br_zeiten.db");
        // SQLCipher-Header ist ein zufälliges Salt, NICHT "SQLite format 3\0".
        std::fs::write(&db_file, [0x42u8; 32]).unwrap();

        let dek = crypto::gen_dek();
        let recovery = crypto::gen_recovery_canonical();
        let kf = crypto::build_keyfile(&dek, "pw123456", &recovery, 9).unwrap();
        crypto::write_keyfile_atomic(&dir, &kf).unwrap();

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "encrypted");
        assert_eq!(status["autoLockMinutes"], 9);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Der Kern-Härtungsfall: verschlüsselte DB vorhanden, keyfile.json fehlt
    /// (gelöscht oder beim Kopieren vergessen). Darf NICHT als firstRun
    /// durchgehen (sonst droht "als neu behandeln"/Überschreib-Versuch).
    #[test]
    fn keyfile_missing_wenn_verschluesselte_db_ohne_keyfile() {
        let dir = temp_test_dir("keyfile-missing");
        let db_file = dir.join("br_zeiten.db");
        std::fs::write(&db_file, [0x99u8; 32]).unwrap();
        // Bewusst KEIN keyfile.json angelegt.

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "keyfileMissing");
        let msg = status["message"].as_str().expect("message vorhanden");
        assert!(msg.contains("keyfile.json"));
        assert!(msg.contains("Wiederherstellungs-Code"));
        assert!(msg.contains(db_file.to_string_lossy().as_ref()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn error_wenn_keyfile_korrupt_und_db_nicht_klartext() {
        let dir = temp_test_dir("corrupt");
        let db_file = dir.join("br_zeiten.db");
        std::fs::write(&db_file, [0x11u8; 32]).unwrap();
        std::fs::write(dir.join(crypto::KEYFILE_NAME), "{ kaputtes json").unwrap();

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "error");
        assert!(status["message"].as_str().unwrap().contains("beschädigt"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn firstrun_bleibt_firstrun_wenn_nur_keyfile_ohne_db_fehlt() {
        // Randfall: keine DB-Datei vorhanden (auch keine verschlüsselte) und
        // kein Keyfile -> weiterhin firstRun, NICHT keyfileMissing (die
        // Härtung greift nur, wenn tatsächlich eine DB-Datei existiert).
        let dir = temp_test_dir("no-db-no-keyfile");
        let db_file = dir.join("br_zeiten.db"); // existiert nicht

        let status = compute_db_status(&dir, &db_file);
        assert_eq!(status["mode"], "firstRun");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ---------- Tests: Backup-Rotation/Namensfindung (reine Dateisystemlogik) ----------

#[cfg(test)]
mod backup_tests {
    use super::{rotate_backups, unique_backup_paths, BACKUP_KEEP_COUNT};
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_test_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "br-log-backup-test-{label}-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("Temp-Testverzeichnis anlegen");
        dir
    }

    fn touch_backup(dir: &std::path::Path, stamp: &str) {
        fs::write(dir.join(format!("br_zeiten-{stamp}.db")), b"db").unwrap();
        fs::write(dir.join(format!("keyfile-{stamp}.json")), b"kf").unwrap();
    }

    // ---------- unique_backup_paths ----------

    #[test]
    fn unique_backup_paths_ohne_kollision_nutzt_stamp_direkt() {
        let dir = temp_test_dir("unique-no-collision");
        let (db, kf) = unique_backup_paths(&dir, "20260702-120000-000");
        assert_eq!(db, dir.join("br_zeiten-20260702-120000-000.db"));
        assert_eq!(kf, dir.join("keyfile-20260702-120000-000.json"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_backup_paths_haengt_bei_kollision_einen_suffix_an() {
        let dir = temp_test_dir("unique-collision");
        let stamp = "20260702-120000-000";
        touch_backup(&dir, stamp); // Zieldatei existiert schon (z. B. Doppelaufruf im selben Millisekunden-Fenster)

        let (db, kf) = unique_backup_paths(&dir, stamp);

        assert_eq!(db, dir.join(format!("br_zeiten-{stamp}-1.db")));
        assert_eq!(kf, dir.join(format!("keyfile-{stamp}-1.json")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_backup_paths_zaehlt_bei_mehrfacher_kollision_hoch() {
        let dir = temp_test_dir("unique-multi-collision");
        let stamp = "20260702-120000-000";
        touch_backup(&dir, stamp);
        touch_backup(&dir, &format!("{stamp}-1"));

        let (db, _kf) = unique_backup_paths(&dir, stamp);

        assert_eq!(db, dir.join(format!("br_zeiten-{stamp}-2.db")));
        let _ = fs::remove_dir_all(&dir);
    }

    // ---------- rotate_backups ----------

    #[test]
    fn rotate_backups_behaelt_alles_wenn_nicht_mehr_als_keep_vorhanden() {
        let dir = temp_test_dir("rotate-under-limit");
        for i in 0..3 {
            touch_backup(&dir, &format!("2026070{i}-000000-000"));
        }

        rotate_backups(&dir, BACKUP_KEEP_COUNT);

        let remaining = fs::read_dir(&dir).unwrap().count();
        assert_eq!(remaining, 6); // 3 * (db + keyfile), nichts gelöscht
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_backups_loescht_die_aeltesten_ueber_dem_limit() {
        let dir = temp_test_dir("rotate-over-limit");
        // 7 Stände anlegen, sortierbare Zeitstempel (chronologisch aufsteigend).
        let stamps: Vec<String> = (0..7)
            .map(|i| format!("20260702-{i:02}0000-000"))
            .collect();
        for s in &stamps {
            touch_backup(&dir, s);
        }

        rotate_backups(&dir, 5);

        // Die zwei ältesten (Index 0,1) müssen weg sein, DB + Keyfile jeweils.
        for old in &stamps[..2] {
            assert!(!dir.join(format!("br_zeiten-{old}.db")).exists());
            assert!(!dir.join(format!("keyfile-{old}.json")).exists());
        }
        // Die fünf neuesten bleiben erhalten.
        for kept in &stamps[2..] {
            assert!(dir.join(format!("br_zeiten-{kept}.db")).exists());
            assert!(dir.join(format!("keyfile-{kept}.json")).exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_backups_ist_ein_no_op_bei_leerem_oder_fehlendem_ordner() {
        let dir = temp_test_dir("rotate-missing").join("does-not-exist");
        // Darf nicht panicken, wenn der Ordner gar nicht existiert.
        rotate_backups(&dir, BACKUP_KEEP_COUNT);
    }
}
