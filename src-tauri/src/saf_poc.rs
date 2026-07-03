// ---------- SAF-PoC (A0.2 Android-Gerätetest) ----------
//
// TEMPORÄR für den A0.2-Gerätetest auf echter Hardware: prüft, ob ein
// Storage-Access-Framework-Roundtrip (Save-Dialog -> schreiben -> Open-Dialog
// -> lesen) funktioniert -- inkl. Umlaute/UTF-8. Bewusst NICHT Teil des
// Signatur-Vertrags der drei bestehenden file_io.rs-Commands
// (export_text_file / export_binary_file / import_text_file): deren
// Android-Arm folgt erst in A-Core. Dieses Command + der zugehörige Button im
// Frontend (DbInfoPanel) fliegen dort wieder raus.

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn saf_poc_roundtrip(app: tauri::AppHandle) -> Result<String, String> {
    use std::io::{Read, Write};
    use tauri_plugin_android_fs::AndroidFsExt;

    const CONTENT: &str = "Prüfung äöüß 123";
    const FILE_NAME: &str = "brlog-saf-poc.txt";

    let api = app.android_fs_async();

    // 1) Save-Dialog: Nutzer wählt/erzeugt die Zieldatei.
    let saved = api
        .file_picker()
        .save_file(None, FILE_NAME, Some("text/plain"), false)
        .await
        .map_err(|e| format!("Save-Dialog fehlgeschlagen: {e}"))?;
    let Some(write_uri) = saved else {
        return Err("Save-Dialog abgebrochen".to_string());
    };

    // 2) Schreiben über die vom Dialog gelieferte content://-URI.
    {
        let mut file = api
            .open_file_writable(&write_uri)
            .await
            .map_err(|e| format!("Datei zum Schreiben öffnen fehlgeschlagen: {e}"))?;
        file.write_all(CONTENT.as_bytes())
            .map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))?;
    }

    // 3) Open-Dialog: Nutzer wählt die soeben geschriebene Datei erneut aus
    //    (bewusster Roundtrip über zwei getrennte SAF-Dialoge, kein direktes
    //    Wiederverwenden der write_uri -- so testet der PoC auch den
    //    Open-Pfad, nicht nur den Save-Pfad).
    let picked = api
        .file_picker()
        .pick_files(None, &["text/plain"], false)
        .await
        .map_err(|e| format!("Open-Dialog fehlgeschlagen: {e}"))?;
    let Some(read_uri) = picked.into_iter().next() else {
        return Err("Open-Dialog abgebrochen".to_string());
    };

    // 4) Lesen + Vergleich.
    let mut buf = String::new();
    {
        let mut file = api
            .open_file_readable(&read_uri)
            .await
            .map_err(|e| format!("Datei zum Lesen öffnen fehlgeschlagen: {e}"))?;
        file.read_to_string(&mut buf)
            .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
    }

    if buf == CONTENT {
        Ok(format!(
            "SAF-Roundtrip OK: \"{buf}\" unverändert gelesen (inkl. Umlaute)."
        ))
    } else {
        Err(format!(
            "SAF-Roundtrip Inhalt weicht ab: geschrieben=\"{CONTENT}\" gelesen=\"{buf}\""
        ))
    }
}

/// Desktop hat kein Storage Access Framework -- der Button im Frontend ist
/// ohnehin per `isAndroid()` versteckt, dieser Arm ist nur der Vollständigkeit
/// halber da (Command muss auf allen Zielen registrierbar sein).
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn saf_poc_roundtrip() -> Result<String, String> {
    Err("nur Android".to_string())
}
