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

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
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
