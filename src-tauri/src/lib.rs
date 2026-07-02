use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde_json::{json, Map, Number, Value as JsonValue};
use tauri::{Manager, State};
use zeroize::Zeroizing;

mod crypto;
mod db_location;
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

/// Aufgelöster DB-Pfad + Modus (portabel/installiert) – nur für die Anzeige.
struct AppDbLocation(DbLocation);

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

/// Prüft einen Ziel-/Quellpfad der Datei-Commands. Die Pfade stammen aus dem
/// nativen Speichern-/Öffnen-Dialog (vom Nutzer bewusst gewählt), deshalb ist ein
/// strikter Ordner-Allowlist hier bewusst NICHT sinnvoll – er würde legitime
/// Exporte/Backups an frei gewählte Orte verhindern. Gehärtet wird gegen leere
/// und relative Pfade (kein CWD-relatives Lesen/Schreiben).
fn check_user_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.trim().is_empty() || !p.is_absolute() {
        return Err("Ungültiger Dateipfad".to_string());
    }
    Ok(p)
}

/// Schreibt eine Textdatei ATOMAR: zuerst in eine Nachbardatei (.brtmp), dann per
/// Rename über das Ziel. Verhindert eine halb geschriebene Export-/Backup-/
/// Recovery-Datei bei Absturz/Stromausfall mitten im Schreiben.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = check_user_path(&path)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Kein Zielverzeichnis".to_string())?;
    let mut tmp_name = target
        .file_name()
        .ok_or_else(|| "Kein Dateiname".to_string())?
        .to_os_string();
    tmp_name.push(".brtmp");
    let tmp = parent.join(tmp_name);
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let target = check_user_path(&path)?;
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

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
const SCHEMA_VERSION: i64 = 1;

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

/// Startentscheidung: firstRun | needsMigration | encrypted | error.
#[tauri::command]
fn db_status(loc: State<'_, AppDbLocation>) -> JsonValue {
    let dir = &loc.0.data_dir;
    let db_file = &loc.0.db_file;
    let plaintext = db_file.exists() && is_plaintext_db(db_file);
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
            json!({ "mode": "error", "message": format!("Schlüsseldatei beschädigt: {m}") })
        }
        crypto::KeyfileState::V1 { auto_lock_minutes } if plaintext => {
            json!({ "mode": "needsMigration", "autoLockMinutes": auto_lock_minutes })
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

/// Erst-Einrichtung OHNE bestehende DB: neue, leere, verschlüsselte DB anlegen.
/// Gibt den Recovery-Code (Anzeigeform) zurück – nur hier einmalig.
#[tauri::command]
fn crypto_setup(
    state: State<'_, DbState>,
    loc: State<'_, AppDbLocation>,
    password: String,
) -> Result<JsonValue, CryptoCmdError> {
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
    let kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden")),
    };
    let dek = if kind == "recovery" {
        let norm = crypto::normalize_recovery(&secret);
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
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden")),
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
    let mut kf = match crypto::classify_keyfile(&loc.0.data_dir) {
        crypto::KeyfileState::V2(kf) => kf,
        crypto::KeyfileState::Corrupt(m) => return Err(CryptoCmdError::Corrupt { message: m }),
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden")),
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
        _ => return Err(db_err("Keine verschlüsselte Datenbank vorhanden")),
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
        src.execute_batch(&format!(
            "ATTACH DATABASE '{}' AS enc KEY \"{}\";",
            tmp_sql, &*keylit
        ))
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
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            read_text_file,
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
            delete_plaintext_backup
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Tauri-Anwendung");
}

// ---------- Tests: Schema-Migration (Tauri-frei, reine rusqlite-Connection) ----------

#[cfg(test)]
mod migration_tests {
    use super::{run_migrations, SCHEMA_VERSION};
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
        assert_eq!(count(&conn, "PRAGMA user_version"), 1);

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
        conn.execute_batch("PRAGMA user_version=2;").unwrap();
        assert!(run_migrations(&mut conn).is_err());
    }
}
