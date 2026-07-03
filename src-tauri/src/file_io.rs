// ---------- Datei-IO (Export/Import, Recovery-Code-TXT) ----------
//
// Kapselt Speichern-/Öffnen-Dialog + Lesen/Schreiben hinter drei
// plattformunabhängigen Commands. Die alten Commands `write_text_file` /
// `read_text_file` (Pfad kam als String aus dem Frontend, das den Dialog über
// @tauri-apps/plugin-dialog selbst geöffnet hatte) sind damit ersetzt: den
// Dialog öffnet jetzt die Rust-Seite (tauri_plugin_dialog::DialogExt), das
// Frontend bekommt nur noch das Ergebnis (Anzeige-Pfad bzw. Name+Inhalt).
//
// Struktur bewusst so gehalten, dass ein späterer Android-Arm ergänzt werden
// kann, ohne die Command-Signaturen zu ändern: `desktop` ist das einzige
// `#[cfg(desktop)]`-gated Implementierungsmodul; ein künftiges
// `#[cfg(target_os = "android")] mod android;` würde dieselben drei
// `pick_*`-Helferfunktionen (vermutlich über ein Storage-Access-Framework /
// content://-URIs statt eines Datei-Dialogs) bereitstellen, ohne dass sich an
// den `#[tauri::command]`-Funktionen unten oder am Frontend-Aufruf etwas
// ändern müsste.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Prüft einen Ziel-/Quellpfad der Datei-Commands. Die Pfade stammen aus dem
/// nativen Speichern-/Öffnen-Dialog (vom Nutzer bewusst gewählt), deshalb ist ein
/// strikter Ordner-Allowlist hier bewusst NICHT sinnvoll – er würde legitime
/// Exporte/Backups an frei gewählte Orte verhindern. Gehärtet wird gegen leere
/// und relative Pfade (kein CWD-relatives Lesen/Schreiben).
fn check_user_path(path: &Path) -> Result<PathBuf, String> {
    let raw = path.to_string_lossy();
    if raw.trim().is_empty() || !path.is_absolute() {
        return Err("Ungültiger Dateipfad".to_string());
    }
    Ok(path.to_path_buf())
}

/// Hängt `.{extension}` an, falls der (vom Dialog gewählte) Pfad noch keine
/// Datei-Endung hat. Nicht alle Dialog-Backends fügen die Filter-Endung
/// automatisch an, wenn der Nutzer keine eingetippt hat -- vor allem auf Linux
/// (GTK-/Portal-Dialoge) ist das inkonsistent, auf Windows i. d. R. kein Thema.
fn ensure_extension(path: PathBuf, extension: &str) -> PathBuf {
    match path.extension() {
        Some(_) => path,
        None => path.with_extension(extension),
    }
}

/// Schreibt Daten ATOMAR: zuerst in eine Nachbardatei (.brtmp), dann per
/// Rename über das Ziel. Verhindert eine halb geschriebene Export-/Backup-/
/// Recovery-Datei bei Absturz/Stromausfall mitten im Schreiben.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Kein Zielverzeichnis".to_string())?;
    let mut tmp_name = target
        .file_name()
        .ok_or_else(|| "Kein Dateiname".to_string())?
        .to_os_string();
    tmp_name.push(".brtmp");
    let tmp = parent.join(tmp_name);
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// Ergebnis von `import_text_file`: Anzeigename (für Fehlermeldungen/UI) +
/// Inhalt der vom Nutzer gewählten Datei.
#[derive(serde::Serialize)]
pub struct ImportedFile {
    pub name: String,
    pub contents: String,
}

// ---------- Desktop-Implementierung (Windows/Linux/macOS) ----------

#[cfg(desktop)]
mod desktop {
    use super::{ensure_extension, PathBuf};
    use tauri::AppHandle;
    use tauri_plugin_dialog::DialogExt;

    /// Öffnet den nativen Speichern-Dialog (blockierend) in einem eigenen
    /// Blocking-Thread, damit der async-Command-Executor nicht blockiert.
    /// `None` = Nutzer hat abgebrochen.
    pub(super) async fn pick_save_path(
        app: &AppHandle,
        default_name: &str,
        filter_name: &str,
        extension: &str,
    ) -> Result<Option<PathBuf>, String> {
        let app = app.clone();
        let default_name = default_name.to_string();
        let filter_name = filter_name.to_string();
        let extension = extension.to_string();
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
            let picked = app
                .dialog()
                .file()
                .add_filter(filter_name, &[extension.as_str()])
                .set_file_name(default_name)
                .blocking_save_file();
            match picked {
                None => Ok(None),
                Some(file_path) => {
                    let raw = file_path.into_path().map_err(|e| e.to_string())?;
                    Ok(Some(ensure_extension(raw, &extension)))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Öffnet den nativen Öffnen-Dialog (blockierend) in einem eigenen
    /// Blocking-Thread. `None` = Nutzer hat abgebrochen.
    pub(super) async fn pick_open_path(
        app: &AppHandle,
        filter_name: &str,
        extension: &str,
    ) -> Result<Option<PathBuf>, String> {
        let app = app.clone();
        let filter_name = filter_name.to_string();
        let extension = extension.to_string();
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
            let picked = app
                .dialog()
                .file()
                .add_filter(filter_name, &[extension.as_str()])
                .blocking_pick_file();
            match picked {
                None => Ok(None),
                Some(file_path) => {
                    let raw = file_path.into_path().map_err(|e| e.to_string())?;
                    Ok(Some(raw))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[cfg(desktop)]
use desktop::{pick_open_path, pick_save_path};

// ---------- Android-Platzhalter (A1) ----------
//
// TEMPORÄR, NUR damit der Crate für Android überhaupt compiliert: die drei
// Commands unten rufen pick_save_path/pick_open_path unconditioniert auf, ein
// echter SAF-basierter Android-Arm (analog zum `desktop`-Modul oben, über
// tauri-plugin-android-fs) kommt erst in A-Core -- Signatur-Vertrag der drei
// `#[tauri::command]`-Funktionen bleibt unangetastet, dieses Modul liefert
// nur einen Kompilierbarkeits-Stub. Dass der eigentliche SAF-Zugriffsweg
// grundsätzlich funktioniert, zeigt der separate PoC in saf_poc.rs.
#[cfg(target_os = "android")]
mod android_stub {
    use super::PathBuf;
    use tauri::AppHandle;

    pub(super) async fn pick_save_path(
        _app: &AppHandle,
        _default_name: &str,
        _filter_name: &str,
        _extension: &str,
    ) -> Result<Option<PathBuf>, String> {
        Err("Noch nicht implementiert auf Android (folgt in A-Core)".to_string())
    }

    pub(super) async fn pick_open_path(
        _app: &AppHandle,
        _filter_name: &str,
        _extension: &str,
    ) -> Result<Option<PathBuf>, String> {
        Err("Noch nicht implementiert auf Android (folgt in A-Core)".to_string())
    }
}

#[cfg(target_os = "android")]
use android_stub::{pick_open_path, pick_save_path};

// ---------- Commands (plattformunabhängige Signatur) ----------

/// Zeigt den Speichern-Dialog, schreibt `contents` als Textdatei ATOMAR an den
/// gewählten Ort. Gibt den Anzeige-Pfad zurück, `None` bei Nutzer-Abbruch.
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extension: String,
    contents: String,
) -> Result<Option<String>, String> {
    let Some(picked) = pick_save_path(&app, &default_name, &filter_name, &extension).await? else {
        return Ok(None);
    };
    let target = check_user_path(&picked)?;
    write_atomic(&target, contents.as_bytes())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// Wie `export_text_file`, aber für Binärinhalte (künftig PDF): `contents_base64`
/// wird vor dem Schreiben dekodiert (Tauri-IPC-Argumente sind JSON, daher
/// Base64 statt roher Bytes).
#[tauri::command]
pub async fn export_binary_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extension: String,
    contents_base64: String,
) -> Result<Option<String>, String> {
    let Some(picked) = pick_save_path(&app, &default_name, &filter_name, &extension).await? else {
        return Ok(None);
    };
    let target = check_user_path(&picked)?;
    let bytes = STANDARD
        .decode(contents_base64)
        .map_err(|e| format!("Ungültige Base64-Daten: {e}"))?;
    write_atomic(&target, &bytes)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// Zeigt den Öffnen-Dialog, liest die gewählte Textdatei. Gibt Anzeigename +
/// Inhalt zurück, `None` bei Nutzer-Abbruch.
#[tauri::command]
pub async fn import_text_file(
    app: tauri::AppHandle,
    filter_name: String,
    extension: String,
) -> Result<Option<ImportedFile>, String> {
    let Some(picked) = pick_open_path(&app, &filter_name, &extension).await? else {
        return Ok(None);
    };
    let source = check_user_path(&picked)?;
    let contents = std::fs::read_to_string(&source).map_err(|e| e.to_string())?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(ImportedFile { name, contents }))
}

// ---------- Tests: reine Dateisystemlogik (kein echter Dialog, kein Tauri-Setup) ----------

#[cfg(test)]
mod tests {
    use super::{check_user_path, ensure_extension, write_atomic};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_test_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "br-log-file-io-test-{label}-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("Temp-Testverzeichnis anlegen");
        dir
    }

    // ---------- check_user_path ----------

    #[test]
    fn check_user_path_akzeptiert_absoluten_pfad() {
        let dir = temp_test_dir("guard-ok");
        let target = dir.join("datei.txt");

        let result = check_user_path(&target).unwrap();

        assert_eq!(result, target);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_user_path_lehnt_relativen_pfad_ab() {
        let target = PathBuf::from("relativ/datei.txt");
        assert!(check_user_path(&target).is_err());
    }

    #[test]
    fn check_user_path_lehnt_leeren_pfad_ab() {
        let target = PathBuf::from("");
        assert!(check_user_path(&target).is_err());
    }

    // ---------- ensure_extension ----------

    #[test]
    fn ensure_extension_haengt_fehlende_endung_an() {
        let path = PathBuf::from("/tmp/BR-Log-Backup");
        let result = ensure_extension(path, "json");
        assert_eq!(result, PathBuf::from("/tmp/BR-Log-Backup.json"));
    }

    #[test]
    fn ensure_extension_laesst_vorhandene_endung_unangetastet() {
        let path = PathBuf::from("/tmp/BR-Log-Backup.json");
        let result = ensure_extension(path, "json");
        assert_eq!(result, PathBuf::from("/tmp/BR-Log-Backup.json"));
    }

    #[test]
    fn ensure_extension_ersetzt_nicht_bei_abweichender_vorhandener_endung() {
        // Der Nutzer hat im Dialog bewusst eine andere Endung eingetippt --
        // wir erzwingen nicht die vom Aufrufer erwartete Endung, wir ergänzen
        // nur die fehlende.
        let path = PathBuf::from("/tmp/Notizen.txt");
        let result = ensure_extension(path, "json");
        assert_eq!(result, PathBuf::from("/tmp/Notizen.txt"));
    }

    // ---------- write_atomic ----------

    #[test]
    fn write_atomic_schreibt_datei_und_raeumt_brtmp_auf() {
        let dir = temp_test_dir("atomic-ok");
        let target = dir.join("export.txt");

        write_atomic(&target, b"Inhalt").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "Inhalt");
        assert!(!dir.join("export.txt.brtmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_ueberschreibt_vorhandene_datei() {
        let dir = temp_test_dir("atomic-overwrite");
        let target = dir.join("export.txt");
        fs::write(&target, b"alt").unwrap();

        write_atomic(&target, b"neu").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "neu");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_atomic_raeumt_brtmp_bei_fehlgeschlagenem_rename_auf() {
        let dir = temp_test_dir("atomic-rename-fail");
        // Ziel ist ein bereits existierendes VERZEICHNIS -- rename(Datei, Verzeichnis)
        // schlägt fehl, die .brtmp-Datei darf danach nicht liegen bleiben.
        let target = dir.join("export.txt");
        fs::create_dir_all(&target).unwrap();

        let result = write_atomic(&target, b"Inhalt");

        assert!(result.is_err());
        assert!(!dir.join("export.txt.brtmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
