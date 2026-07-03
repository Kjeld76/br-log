// ---------- Datei-IO (Export/Import, Recovery-Code-TXT) ----------
//
// Kapselt Speichern-/Öffnen-Dialog + Lesen/Schreiben hinter drei
// plattformunabhängigen Commands. Die alten Commands `write_text_file` /
// `read_text_file` (Pfad kam als String aus dem Frontend, das den Dialog über
// @tauri-apps/plugin-dialog selbst geöffnet hatte) sind damit ersetzt: den
// Dialog öffnet jetzt die Rust-Seite (tauri_plugin_dialog::DialogExt), das
// Frontend bekommt nur noch das Ergebnis (Anzeige-Pfad bzw. Name+Inhalt).
//
// Zwei komplett getrennte Implementierungen pro Plattform, gleiche
// `#[tauri::command]`-Signaturen (A-Core):
// - `desktop` (Windows/Linux/macOS): echter absoluter Dateipfad aus
//   tauri-plugin-dialog, Schreiben/Lesen über std::fs (atomar via
//   write_atomic).
// - `android`: Storage Access Framework über tauri-plugin-android-fs
//   (content://-URIs statt Pfaden -- std::fs kann darauf nicht zugreifen,
//   deshalb sind die drei Commands hier vollständig eigene Bodies, keine
//   gemeinsame PathBuf-basierte Helferfunktion). API-Muster stammt vom
//   A0.2-Gerätetest (saf_poc.rs, dort verifiziert inkl. Umlaute/UTF-8).
//   Rückgabe ist dort statt eines Pfads der Anzeigename (SAF-URIs sind
//   kryptisch und für Nutzer wertlos).

use std::path::PathBuf;
// Nur Desktop: `Path` (Borrow-Form) wird ausschließlich von den unten
// `#[cfg(desktop)]`-gated Funktionen check_user_path/write_atomic gebraucht --
// auf Android sonst "unused import".
#[cfg(desktop)]
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Prüft einen Ziel-/Quellpfad der Datei-Commands. Die Pfade stammen aus dem
/// nativen Speichern-/Öffnen-Dialog (vom Nutzer bewusst gewählt), deshalb ist ein
/// strikter Ordner-Allowlist hier bewusst NICHT sinnvoll – er würde legitime
/// Exporte/Backups an frei gewählte Orte verhindern. Gehärtet wird gegen leere
/// und relative Pfade (kein CWD-relatives Lesen/Schreiben).
///
/// Nur Desktop: Android hat keine absoluten Dateipfade, sondern content://-URIs
/// (siehe `mod android`) -- dieser Guard ist für dieses Pfad-Konzept sinnlos.
#[cfg(desktop)]
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
///
/// Plattformübergreifend (Desktop UND Android): der Android-Arm (`mod
/// android`) wendet dieselbe Absicherung auf den an den SAF-Save-Dialog
/// übergebenen `default_name` an, bevor der Picker ihn als Vorschlag anzeigt.
fn ensure_extension(path: PathBuf, extension: &str) -> PathBuf {
    match path.extension() {
        Some(_) => path,
        None => path.with_extension(extension),
    }
}

/// Schreibt Daten ATOMAR: zuerst in eine Nachbardatei (.brtmp), dann per
/// Rename über das Ziel. Verhindert eine halb geschriebene Export-/Backup-/
/// Recovery-Datei bei Absturz/Stromausfall mitten im Schreiben.
///
/// Nur Desktop: setzt einen echten Dateisystem-Ordner voraus (Nachbardatei +
/// Rename). Android schreibt stattdessen direkt über die vom SAF-Dialog
/// gelieferte content://-URI (siehe `mod android`) -- dort gibt es keine
/// Nachbardatei, in die atomar geschrieben werden könnte.
#[cfg(desktop)]
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

// ---------- Android-Implementierung (A-Core) ----------
//
// Storage Access Framework über tauri-plugin-android-fs (Android-only
// Dependency, Plugin-Init in lib.rs). API-Muster geprüft im A0.2-Gerätetest
// (saf_poc.rs, dort gelöscht -- der volle Roundtrip Save-Dialog -> schreiben
// -> Open-Dialog -> lesen inkl. Umlaute/UTF-8 war dort erfolgreich).
//
// Bewusst KEIN spawn_blocking (anders als `desktop` oben): die
// android-fs-Async-API (`app.android_fs_async()`) ruft über Tauris
// Mobile-Plugin-Kanal in den Kotlin-Teil des Plugins -- das ist ein
// Await auf eine Antwort über den Channel, kein synchron blockierender aufruf
// wie `blocking_save_file()` auf Desktop. Der PoC hat exakt diesen Weg (nur
// `.await`, kein spawn_blocking) auf echter Hardware verifiziert.
#[cfg(target_os = "android")]
mod android {
    use super::{ensure_extension, ImportedFile, PathBuf};
    use std::io::{Read, Write};
    use tauri::AppHandle;
    use tauri_plugin_android_fs::AndroidFsExt;

    /// MIME-Typ aus der Datei-Endung. SAF kennt -- anders als der
    /// Desktop-Dialog (`add_filter` mit Endungsliste) -- keinen reinen
    /// Endungs-Filter; Save- wie Open-Dialog brauchen einen MIME-String.
    fn mime_for_extension(extension: &str) -> &'static str {
        match extension.to_ascii_lowercase().as_str() {
            "csv" => "text/csv",
            "json" => "application/json",
            "txt" => "text/plain",
            "pdf" => "application/pdf",
            _ => "application/octet-stream",
        }
    }

    /// Speichert `bytes` über den SAF-Save-Dialog. Rückgabe ist der
    /// Anzeigename (nicht die content://-URI -- die ist kryptisch und für
    /// Nutzer wertlos): der vom Provider gelieferte Name, wenn abrufbar,
    /// sonst der (endungsgesicherte) `default_name`. `None` bei Abbruch.
    pub(super) async fn save(
        app: &AppHandle,
        default_name: &str,
        extension: &str,
        bytes: &[u8],
    ) -> Result<Option<String>, String> {
        let suggested_name = ensure_extension(PathBuf::from(default_name), extension)
            .to_string_lossy()
            .into_owned();

        let api = app.android_fs_async();
        let saved = api
            .file_picker()
            .save_file(
                None,
                &suggested_name,
                Some(mime_for_extension(extension)),
                false,
            )
            .await
            .map_err(|e| format!("Speichern-Dialog fehlgeschlagen: {e}"))?;
        let Some(uri) = saved else {
            return Ok(None);
        };

        {
            let mut file = api
                .open_file_writable(&uri)
                .await
                .map_err(|e| format!("Datei zum Schreiben öffnen fehlgeschlagen: {e}"))?;
            file.write_all(bytes)
                .map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))?;
        }

        let name = api
            .get_name(&uri)
            .await
            .unwrap_or(suggested_name);
        Ok(Some(name))
    }

    /// Zeigt den SAF-Open-Dialog mit MIME-Filter, liest die gewählte Datei als
    /// Text. `None` bei Abbruch.
    pub(super) async fn open_text(
        app: &AppHandle,
        extension: &str,
    ) -> Result<Option<ImportedFile>, String> {
        let api = app.android_fs_async();
        let picked = api
            .file_picker()
            .pick_files(None, &[mime_for_extension(extension)], false)
            .await
            .map_err(|e| format!("Öffnen-Dialog fehlgeschlagen: {e}"))?;
        let Some(uri) = picked.into_iter().next() else {
            return Ok(None);
        };

        let mut contents = String::new();
        {
            let mut file = api
                .open_file_readable(&uri)
                .await
                .map_err(|e| format!("Datei zum Lesen öffnen fehlgeschlagen: {e}"))?;
            file.read_to_string(&mut contents)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
        }

        // Fällt bei Bedarf auf den letzten URI-Pfadabschnitt zurück (statt
        // einen erfolgreichen Import an einer reinen Namensanzeige scheitern
        // zu lassen) -- anders als beim Speichern gibt es hier keinen
        // `default_name`, auf den ausgewichen werden könnte.
        let name = api.get_name_or_last_path_segment(&uri).await;
        Ok(Some(ImportedFile { name, contents }))
    }
}

/// Dekodiert Base64-Binärinhalte (Tauri-IPC-Argumente sind JSON, daher Base64
/// statt roher Bytes) -- gemeinsam für den Desktop- und den Android-Arm von
/// `export_binary_file`.
fn decode_base64(contents_base64: String) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(contents_base64)
        .map_err(|e| format!("Ungültige Base64-Daten: {e}"))
}

// ---------- Commands (plattformunabhängige Signatur) ----------

/// Zeigt den Speichern-Dialog, schreibt `contents` als Textdatei ATOMAR an den
/// gewählten Ort. Gibt den Anzeige-Pfad zurück, `None` bei Nutzer-Abbruch.
#[cfg(desktop)]
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

/// Android-Arm: SAF-Save-Dialog statt Desktop-Dateidialog (siehe `mod
/// android`). Gibt den Anzeigenamen zurück, `None` bei Nutzer-Abbruch.
/// `filter_name` bleibt Teil der Signatur (Frontend ruft plattformagnostisch
/// auf), wird hier aber nicht gebraucht: SAF kennt keinen Endungs-Filter wie
/// der Desktop-Dialog, die MIME-Zuordnung übernimmt `mime_for_extension`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extension: String,
    contents: String,
) -> Result<Option<String>, String> {
    let _ = filter_name;
    android::save(&app, &default_name, &extension, contents.as_bytes()).await
}

/// Wie `export_text_file`, aber für Binärinhalte (künftig PDF): `contents_base64`
/// wird vor dem Schreiben dekodiert (Tauri-IPC-Argumente sind JSON, daher
/// Base64 statt roher Bytes).
#[cfg(desktop)]
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
    let bytes = decode_base64(contents_base64)?;
    write_atomic(&target, &bytes)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// Android-Arm von `export_binary_file`, siehe `export_text_file` (Android)
/// für die Begründung von `filter_name`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn export_binary_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extension: String,
    contents_base64: String,
) -> Result<Option<String>, String> {
    let _ = filter_name;
    let bytes = decode_base64(contents_base64)?;
    android::save(&app, &default_name, &extension, &bytes).await
}

/// Zeigt den Öffnen-Dialog, liest die gewählte Textdatei. Gibt Anzeigename +
/// Inhalt zurück, `None` bei Nutzer-Abbruch.
#[cfg(desktop)]
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

/// Android-Arm: SAF-Open-Dialog statt Desktop-Dateidialog (siehe `mod
/// android`). `filter_name` s. Begründung bei `export_text_file` (Android).
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn import_text_file(
    app: tauri::AppHandle,
    filter_name: String,
    extension: String,
) -> Result<Option<ImportedFile>, String> {
    let _ = filter_name;
    android::open_text(&app, &extension).await
}

// ---------- Tests: reine Dateisystemlogik (kein echter Dialog, kein Tauri-Setup) ----------
//
// Nur Desktop: prüft check_user_path/write_atomic, die es auf Android nicht
// gibt (dort gibt es keine absoluten Dateipfade, siehe `mod android`).
#[cfg(all(test, desktop))]
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
