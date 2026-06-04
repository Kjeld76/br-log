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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Hinweis: KEINE prüfsummen-validierten Migrationen mehr. Das Schema wird im
    // Frontend idempotent angelegt (src/db/schema.ts, CREATE TABLE IF NOT EXISTS).
    // Grund: tauri-plugin-sql (sqlx) prüft eine SHA-Prüfsumme über den Migrations-
    // SQL; Zeilenenden-Unterschiede (CRLF auf CI vs. LF lokal) oder jede
    // Inhaltsänderung brachen bestehende DBs mit "migration ... has been modified".
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![write_text_file, read_text_file])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Tauri-Anwendung");
}
