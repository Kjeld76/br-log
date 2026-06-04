use tauri_plugin_sql::{Migration, MigrationKind};

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
    // Versionierte Migrationen. Künftige Schemaänderungen NUR ANHÄNGEN
    // (neue Migration mit höherer version).
    // WARNUNG: Eine bereits ausgelieferte Migrationsdatei darf NIE geändert werden –
    // auch kein Kommentar/Whitespace. tauri-plugin-sql (sqlx) prüft eine Prüfsumme
    // über den SQL-Text; jede Änderung bricht bestehende DBs mit
    // "migration X was previously applied but has been modified".
    let migrations = vec![Migration {
        version: 1,
        description: "init schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:br_zeiten.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![write_text_file, read_text_file])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Tauri-Anwendung");
}
