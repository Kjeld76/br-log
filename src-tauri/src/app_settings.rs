// Kleine, UNVERSCHLÜSSELTE App-Einstellungen (app_settings.json im
// Datenordner neben der DB). Hier liegt NUR Unkritisches (Fensterverhalten) --
// alles Vertrauliche gehört in die verschlüsselte DB bzw. keyfile.json.
//
// Grund für eine eigene Datei statt localStorage: der CloseRequested-Handler
// (Tray-Verhalten, siehe run()) läuft in Rust und braucht den Wert SYNCHRON,
// bevor das Fenster schließt -- ein Umweg über die WebView wäre ein Race.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Desktop: Fenster-Schließen versteckt ins Tray statt zu beenden
    /// (opt-in; Erinnerungen feuern dann auch bei "geschlossener" App weiter).
    pub close_to_tray: bool,
}

const FILE_NAME: &str = "app_settings.json";

fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.try_state::<crate::AppDbLocation>()
        .map(|loc| loc.0.data_dir.join(FILE_NAME))
}

/// Einstellungen lesen; fehlende/kaputte Datei = Defaults (kein Fehlerfall).
pub fn load(app: &tauri::AppHandle) -> AppSettings {
    let Some(path) = settings_path(app) else {
        return AppSettings::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn app_settings_get(app: tauri::AppHandle) -> AppSettings {
    load(&app)
}

#[tauri::command]
pub fn app_settings_set(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app).ok_or_else(|| "Datenordner unbekannt".to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    // Atomar wie file_io::write_atomic (tmp + rename), aber ohne dessen
    // Pfad-Härtung -- der Pfad kommt hier aus der App selbst, nie vom Nutzer.
    let tmp = path.with_extension("json.brtmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}
