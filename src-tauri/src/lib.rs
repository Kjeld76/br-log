use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde_json::{json, Map, Number, Value as JsonValue};
use tauri::{Manager, State};

mod db_location;
use db_location::DbLocation;

/// DB-State: das Ergebnis des einmaligen Verbindungsaufbaus. Bei Erfolg die
/// offene Connection, sonst die Fehlermeldung. So paniert ein fehlgeschlagener
/// Verbindungsaufbau NICHT beim Start, sondern wird über db_execute/db_select als
/// Err ans Frontend gereicht und dort im "Fehler beim Start"-Screen angezeigt.
type DbState = Mutex<Result<Connection, String>>;

/// Aufgelöster DB-Pfad + Modus (portabel/installiert) – nur für die Anzeige.
struct AppDbLocation(DbLocation);

/// Schreibt eine Textdatei an einen beliebigen, vom Nutzer im Dialog gewählten
/// Pfad. Eigene Command-Funktion statt fs-Plugin -> keine Scope-Konfiguration nötig.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Liest eine Textdatei (für JSON-Import) von einem im Dialog gewählten Pfad.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ---------- DB-Layer (rusqlite) ----------
// Generische execute/select-Commands. Das Frontend (src/db/client.ts) ruft sie
// über einen dünnen Shim auf, der das frühere `@tauri-apps/plugin-sql`-Interface
// (db.execute / db.select) nachbildet -> src/db/repository.ts bleibt unverändert.

/// Wandelt einen JSON-Wert (Bind-Parameter aus dem Frontend) in einen
/// SQLite-bindbaren Wert. Booleans -> 0/1 (wie es das Frontend ohnehin schon
/// sendet), NULL bleibt NULL (wichtig für nullable Spalten wie start_time).
fn json_to_sql(v: &JsonValue) -> Result<SqlValue, String> {
    Ok(match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(u) = n.as_u64() {
                // u64 jenseits i64 -> als f64 ablegen statt zu panischen.
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
        // Arrays/Objekte haben kein SQLite-Skalar -> als JSON-Text ablegen.
        other @ (JsonValue::Array(_) | JsonValue::Object(_)) => SqlValue::Text(other.to_string()),
    })
}

/// INSERT/UPDATE/DELETE/DDL. Gibt die Zahl betroffener Zeilen zurück (vom
/// Frontend ignoriert, aber nützlich/kompatibel).
#[tauri::command]
fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<usize, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().map_err(|e| e.clone())?;
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect::<Result<_, _>>()?;
    conn.execute(&sql, rusqlite::params_from_iter(sql_params.iter()))
        .map_err(|e| e.to_string())
}

/// SELECT. Liefert ein Array von Zeilen-Objekten, gekeyt nach Spaltenname
/// (snake_case) -> identische Form wie zuvor `plugin-sql`/sqlx, daher passen die
/// Roh-Zeilentypen (EntryRow, ObjectionRow …) in repository.ts unverändert.
#[tauri::command]
fn db_select(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().map_err(|e| e.clone())?;
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // Spaltennamen VOR der Query festhalten (müssen den rows-Borrow überleben).
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
                // NaN/Inf haben keine JSON-Entsprechung -> null.
                ValueRef::Real(f) => Number::from_f64(f)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null),
                ValueRef::Text(bytes) => {
                    JsonValue::String(String::from_utf8_lossy(bytes).into_owned())
                }
                // BLOBs kommen im aktuellen Schema nicht vor; defensiv als Byte-Array.
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

/// Liefert den aktuellen DB-Pfad + Modus an die UI (DbInfoPanel-Anzeige + Badge).
/// Ersetzt die frühere Frontend-seitige Pfadberechnung via appConfigDir/join.
#[tauri::command]
fn db_path(state: State<'_, AppDbLocation>) -> JsonValue {
    json!({
        "dbFile": state.0.db_file.to_string_lossy(),
        "dataDir": state.0.data_dir.to_string_lossy(),
        "portable": state.0.portable,
    })
}

/// Öffnet die DB an `db_file`. Alle Fehler werden als String zurückgegeben
/// (kein Panic) -> sichtbar in der UI ("Fehler beim Start").
fn open_db(db_file: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Datenverzeichnis nicht anlegbar ({}): {e}", parent.display()))?;
    }
    eprintln!("BR-Log DB: {}", db_file.display());
    let conn = Connection::open(db_file)
        .map_err(|e| format!("DB nicht öffnenbar ({}): {e}", db_file.display()))?;
    // Schadlos bei diesem Schema (keine FK-Klauseln); busy_timeout gegen
    // SQLITE_BUSY. journal_mode bleibt unangetastet (Kompatibilität).
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("PRAGMA-Initialisierung fehlgeschlagen: {e}"))?;
    Ok(conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Hinweis: KEINE prüfsummen-validierten Migrationen. Das Schema wird im
    // Frontend idempotent angelegt (src/db/schema.ts, CREATE TABLE IF NOT EXISTS).
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // DB-Pfad bestimmen (portabel neben EXE vs. installiert in %APPDATA%),
            // dann öffnen. Fehler werden im DbState abgelegt (kein harter Start-Crash).
            let (loc, db_result): (DbLocation, Result<Connection, String>) =
                match app.path().app_config_dir() {
                    Ok(cfg_dir) => {
                        let loc = db_location::resolve(cfg_dir);
                        let opened = open_db(&loc.db_file);
                        (loc, opened)
                    }
                    Err(e) => (
                        // Sentinel-Location -> db_path bleibt aufrufbar (kein Panic),
                        // selbst wenn das Konfig-Verzeichnis nicht ermittelbar ist.
                        DbLocation {
                            db_file: PathBuf::new(),
                            data_dir: PathBuf::new(),
                            portable: false,
                        },
                        Err(format!("Kein App-Konfigurationsverzeichnis: {e}")),
                    ),
                };
            // AppDbLocation IMMER managen, damit der db_path-Command nie paniert.
            app.manage(AppDbLocation(loc));
            app.manage::<DbState>(Mutex::new(db_result));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            read_text_file,
            db_execute,
            db_select,
            db_path
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Tauri-Anwendung");
}
