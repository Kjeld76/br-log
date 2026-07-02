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
/// Kennzeile, die in portable.txt stehen MUSS, damit der portable Modus greift.
/// Bloße Existenz genügt NICHT -> eine leere oder fremde `portable.txt` aktiviert
/// nichts. Schutz davor, das BR-Geheimnis versehentlich in einen
/// Cloud-synchronisierten Ordner (OneDrive/Dropbox) zu legen.
const MARKER_SENTINEL: &str = "BR-Log-Portable";

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

/// true, wenn neben der EXE eine GÜLTIGE Markerdatei liegt: portable.txt muss
/// existieren UND eine Zeile gleich MARKER_SENTINEL enthalten.
fn marker_present(dir: &Path) -> bool {
    match fs::read_to_string(dir.join(MARKER_NAME)) {
        // Führendes UTF-8-BOM entfernen (Windows-Editoren wie Notepad fügen es ein;
        // Rust-trim() würde es nicht abstreifen und den Sentinel-Vergleich brechen).
        Ok(content) => content
            .trim_start_matches('\u{feff}')
            .lines()
            .any(|l| l.trim() == MARKER_SENTINEL),
        Err(_) => false,
    }
}

/// Entscheidet portabel vs. installiert und liefert den absoluten DB-Pfad.
/// `app_config_dir` ist das bereits aufgelöste %APPDATA%/<identifier>.
pub fn resolve(app_config_dir: PathBuf) -> DbLocation {
    resolve_with_exe_dir(exe_dir(), app_config_dir)
}

/// Kern der Entscheidungslogik mit injizierbarem EXE-Ordner -> ohne diese
/// Trennung ließe sich der Portabel-Zweig in Tests nicht erreichen, weil
/// `exe_dir()` im Test-Binary auf `target/.../deps` zeigt, nicht auf einen
/// kontrollierbaren Ordner.
fn resolve_with_exe_dir(exe_dir: Option<PathBuf>, app_config_dir: PathBuf) -> DbLocation {
    if let Some(dir) = exe_dir {
        if marker_present(&dir) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Eindeutiges, isoliertes Verzeichnis unter dem System-Temp-Ordner.
    fn temp_test_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "br-log-dbloc-test-{label}-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("Temp-Testverzeichnis anlegen");
        dir
    }

    // ---------- is_writable ----------

    #[test]
    fn is_writable_true_fuer_vorhandenes_beschreibbares_verzeichnis() {
        let dir = temp_test_dir("writable");
        assert!(is_writable(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_writable_false_fuer_nicht_existierendes_verzeichnis() {
        // OpenOptions::create() legt keine fehlenden Elternverzeichnisse an ->
        // ein nicht vorhandenes Verzeichnis ist zuverlässig "nicht beschreibbar".
        let missing = std::env::temp_dir().join("br-log-dbloc-test-does-not-exist-xyz");
        let _ = fs::remove_dir_all(&missing);
        assert!(!is_writable(&missing));
    }

    // ---------- marker_present ----------

    #[test]
    fn marker_present_true_bei_exaktem_sentinel() {
        let dir = temp_test_dir("marker-ok");
        fs::write(dir.join(MARKER_NAME), "BR-Log-Portable\nweiterer Text").unwrap();
        assert!(marker_present(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_present_true_trotz_bom_und_umgebendem_whitespace() {
        let dir = temp_test_dir("marker-bom");
        let content = "\u{feff}Kopfzeile\r\n  BR-Log-Portable  \r\nFusszeile\r\n";
        fs::write(dir.join(MARKER_NAME), content).unwrap();
        assert!(marker_present(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_present_false_ohne_datei() {
        let dir = temp_test_dir("marker-missing");
        assert!(!marker_present(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_present_false_bei_falschem_inhalt() {
        let dir = temp_test_dir("marker-wrong");
        // Bloße Existenz der Datei genügt NICHT -> Inhalt muss stimmen.
        fs::write(dir.join(MARKER_NAME), "irgendein anderer Text").unwrap();
        assert!(!marker_present(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    // ---------- resolve_with_exe_dir ----------

    #[test]
    fn installations_modus_ohne_marker() {
        let exe = temp_test_dir("resolve-no-marker-exe");
        let cfg = temp_test_dir("resolve-no-marker-cfg");

        let loc = resolve_with_exe_dir(Some(exe.clone()), cfg.clone());

        assert!(!loc.portable);
        assert_eq!(loc.data_dir, cfg);
        assert_eq!(loc.db_file, cfg.join(DB_FILE_NAME));
        assert!(cfg.exists()); // wird bei Bedarf angelegt

        let _ = fs::remove_dir_all(&exe);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn installations_modus_wenn_exe_ordner_unbekannt() {
        let cfg = temp_test_dir("resolve-no-exe-cfg");
        let loc = resolve_with_exe_dir(None, cfg.clone());
        assert!(!loc.portable);
        assert_eq!(loc.data_dir, cfg);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn portabler_modus_bei_gueltigem_marker() {
        let exe = temp_test_dir("resolve-portable-exe");
        fs::write(exe.join(MARKER_NAME), "BR-Log-Portable").unwrap();
        let cfg = temp_test_dir("resolve-portable-cfg");

        let loc = resolve_with_exe_dir(Some(exe.clone()), cfg.clone());

        assert!(loc.portable);
        assert_eq!(loc.data_dir, exe.join(DATA_DIR_NAME));
        assert_eq!(loc.db_file, exe.join(DATA_DIR_NAME).join(DB_FILE_NAME));
        assert!(loc.data_dir.exists()); // idempotent angelegt

        let _ = fs::remove_dir_all(&exe);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn installations_modus_bei_marker_ohne_sentinel_zeile() {
        let exe = temp_test_dir("resolve-bad-marker-exe");
        fs::write(exe.join(MARKER_NAME), "leer/falsch").unwrap();
        let cfg = temp_test_dir("resolve-bad-marker-cfg");

        let loc = resolve_with_exe_dir(Some(exe.clone()), cfg.clone());

        assert!(!loc.portable);
        assert_eq!(loc.data_dir, cfg);

        let _ = fs::remove_dir_all(&exe);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn portabler_modus_bleibt_bestehen_wenn_bereits_eine_portable_db_existiert() {
        // Deckt den "kein stiller Rückfall"-Zweig ab: liegt bereits eine DB im
        // (bei Testlauf reell beschreibbaren) Portable-Ordner, bleibt der Modus
        // portabel, unabhängig vom is_writable-Ergebnis.
        let exe = temp_test_dir("resolve-existing-db-exe");
        fs::write(exe.join(MARKER_NAME), "BR-Log-Portable").unwrap();
        let data_dir = exe.join(DATA_DIR_NAME);
        fs::create_dir_all(&data_dir).unwrap();
        fs::write(data_dir.join(DB_FILE_NAME), b"dummy").unwrap();
        let cfg = temp_test_dir("resolve-existing-db-cfg");

        let loc = resolve_with_exe_dir(Some(exe.clone()), cfg.clone());

        assert!(loc.portable);
        assert_eq!(loc.db_file, data_dir.join(DB_FILE_NAME));

        let _ = fs::remove_dir_all(&exe);
        let _ = fs::remove_dir_all(&cfg);
    }
}
