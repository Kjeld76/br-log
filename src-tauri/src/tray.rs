// System-Tray (nur Desktop): Menü "Öffnen"/"Sofort sperren"/"Beenden",
// Linksklick zeigt das Fenster. Zusammen mit close_to_tray (app_settings.rs)
// läuft BR-Log damit beim Fenster-Schließen im Hintergrund weiter, sodass
// Termin-Erinnerungen (Snapshot-Scheduler in App.tsx) weiter feuern.
// Sicherheitsmodell unberührt: das Verstecken löst über die
// Page-Visibility-API weiterhin den Auto-Lock aus -- die DB ist im
// Tray-Betrieb also gesperrt, die Erinnerungen kommen aus dem
// In-Memory-Snapshot (nur Titel/Zeit).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// "Sofort sperren" (Issue #17, Task 6): das Tray-Menü selbst kennt die DB-
/// Verschlüsselung nicht -- es sendet nur ein Event, das App.tsx auf denselben
/// Sperr-Pfad wie die Menü-/Hotkey-Sofortsperre (doLock) routet. Funktioniert
/// bewusst auch bei verstecktem Fenster: die App bleibt im Tray-Betrieb
/// gemountet (Bestandsverhalten), der Event-Listener läuft also unabhängig
/// von der Fenster-Sichtbarkeit weiter. Best-effort (emit-Fehler ignoriert,
/// analog zu show_main oben) -- ein fehlgeschlagenes Event ist kein Grund,
/// den Menü-Handler abstürzen zu lassen.
fn lock_now(app: &tauri::AppHandle) {
    let _ = app.emit("brlog://lock", ());
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "BR-Log öffnen", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Sofort sperren", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &lock, &quit])?;
    TrayIconBuilder::with_id("main")
        .icon(
            app.default_window_icon()
                .expect("Fenster-Icon ist im Bundle vorhanden")
                .clone(),
        )
        .tooltip("BR-Log")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "lock" => lock_now(app),
            // Echtes Beenden am CloseRequested-Handler vorbei (exit statt
            // close), sonst würde close_to_tray das Beenden verhindern.
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
