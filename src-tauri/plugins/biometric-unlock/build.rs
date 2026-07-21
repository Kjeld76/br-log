// Registriert die Plugin-Commands fuer die Tauri-ACL und -- auf Android-Targets --
// bindet den Kotlin-Teil (android/) ein: tauri-plugin kopiert die tauri-android-
// Bibliothek nach android/.tauri/tauri-api und meldet den Android-Projektpfad via
// `cargo:android_library_path`, den tauri-build der App wiederum in
// gen/android/tauri.settings.gradle einhaengt.
//
// Die Command-Namen hier sind fuer die ACL-Permission-Generierung. Aufgerufen
// werden die Methoden faktisch NUR Rust-seitig ueber run_mobile_plugin (die
// Webview ruft nie direkt ins Plugin), daher sind diese Permissions vestigial --
// aber der Build-Helfer erwartet die Liste.
const COMMANDS: &[&str] = &[
    "is_available",
    "enroll",
    "authenticate",
    "remove_key",
    // Issue #17, Task 7: fachlich nicht Biometrie, haengt aber bewusst an
    // diesem bereits registrierten Plugin (s. Kommentar in
    // BiometricUnlockPlugin.kt/lib.rs).
    "set_secure_screen",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        // Beim Doku-Build fuer Android schlaegt das erwartungsgemaess fehl und ist
        // fuer die Crate-Doku irrelevant (gleiche Absicherung wie die offiziellen
        // Plugins).
        .unwrap_or_else(|error| {
            if !(cfg!(docsrs)
                && std::env::var("TARGET").is_ok_and(|t| t.contains("android")))
            {
                panic!("tauri-plugin build fehlgeschlagen: {error}");
            }
        });
}
