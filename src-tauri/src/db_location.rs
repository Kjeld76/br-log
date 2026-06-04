// Pfad-Auflösung für die SQLite-Datei: portabler Modus (USB-Stick) vs.
// Installations-Modus. Bewusst frei von Tauri-Typen (app_config_dir wird
// hereingereicht) -> reine, gut testbare Entscheidungslogik.
//
//   Portabel:    Marker `portable.txt` neben der EXE UND EXE-Ordner beschreibbar
//                -> <EXE-Ordner>/BR-Log-Data/br_zeiten.db
//   Installiert: sonst (Default + Fallback)
//                -> %APPDATA%/de.betriebsrat.brzeiten/br_zeiten.db (unverändert)
//
// Identifier `de.betriebsrat.brzeiten` und Dateiname `br_zeiten.db` bleiben in
// beiden Modi gleich (CLAUDE.md: Datenkontinuität – nicht umbenennen).

use std::fs;
use std::path::{Path, PathBuf};

/// Ergebnis der Pfad-Auflösung: wo die Datei liegt + welcher Modus gewählt wurde.
#[derive(Clone, Debug)]
pub struct DbLocation {
    /// Absoluter Pfad zur SQLite-Datei (direkt an Connection::open).
    pub db_file: PathBuf,
    /// Verzeichnis der DB-Datei (für „im Explorer öffnen").
    pub data_dir: PathBuf,
    /// true => portabel aus dem EXE-Ordner; false => Installations-Modus.
    pub portable: bool,
}

const DATA_DIR_NAME: &str = "BR-Log-Data";
const DB_FILE_NAME: &str = "br_zeiten.db";
const MARKER_NAME: &str = "portable.txt";

/// Ordner der laufenden EXE. current_exe() löst Symlinks auf, .parent() entfernt
/// den Dateinamen.
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

/// Beschreibbarkeit durch tatsächliches Anlegen + Löschen einer Testdatei prüfen.
/// Read-only-ACLs / schreibgeschützte Sticks zeigen sich erst beim echten
/// Schreibversuch – ein metadata().permissions().readonly()-Check genügt NICHT.
fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".br-log-write-test.tmp");
    match fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe); // best-effort Aufräumen
            true
        }
        Err(_) => false,
    }
}

/// Entscheidet portabel vs. installiert und liefert den absoluten DB-Pfad.
/// `app_config_dir` ist das bereits aufgelöste %APPDATA%/<identifier>.
pub fn resolve(app_config_dir: PathBuf) -> DbLocation {
    if let Some(dir) = exe_dir() {
        if dir.join(MARKER_NAME).exists() {
            let data_dir = dir.join(DATA_DIR_NAME);
            let db_file = data_dir.join(DB_FILE_NAME);
            // Datenordner anlegen (idempotent); Erfolg + Schreibprobe = Stick beschreibbar.
            let creatable = fs::create_dir_all(&data_dir).is_ok();
            // Portabel, wenn der Ordner beschreibbar ist ODER dort bereits eine
            // portable DB liegt. Letzteres verhindert, dass ein schreibgeschützter
            // Stick STILL auf eine leere %APPDATA%-DB zurückfällt und Datenverlust
            // vortäuscht – stattdessen meldet open_db einen echten Fehler.
            if (creatable && is_writable(&data_dir)) || db_file.exists() {
                return DbLocation {
                    db_file,
                    data_dir,
                    portable: true,
                };
            }
            // Marker vorhanden, Ordner nicht beschreibbar UND noch keine DB ->
            // Fallback Installations-Modus (kein Datenverlust, kein harter Fehler).
        }
    }

    // Installations-Modus (Default + Fallback).
    let _ = fs::create_dir_all(&app_config_dir);
    DbLocation {
        db_file: app_config_dir.join(DB_FILE_NAME),
        data_dir: app_config_dir,
        portable: false,
    }
}
