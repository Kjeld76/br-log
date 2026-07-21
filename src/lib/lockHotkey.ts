// Verdrahtung des globalen Sofortsperre-Hotkeys (Issue #17, Desktop-only) mit
// @tauri-apps/plugin-global-shortcut. Reine Helfer-Logik (Accelerator bauen/
// formatieren) liegt in hotkey.ts und ist dort TDD-getestet -- diese Datei
// kapselt nur die IO-Seite (localStorage + Plugin-Aufrufe), analog zum
// bestehenden Muster für tauri-plugin-autostart in ReminderSettings.tsx
// (dynamischer Import, weil das Plugin nur im Desktop-Build existiert).
//
// Persistenz bewusst über localStorage statt app_settings.json: der
// Accelerator ist kein Geheimnis (siehe Auftrag) und wird nur im Frontend
// gebraucht -- anders als close_to_tray (app_settings.rs), das synchron vom
// Rust-CloseRequested-Handler gelesen werden muss.

import { isAndroid } from "./platform";

const ENABLED_KEY = "brlog.lockHotkeyEnabled";
const ACCEL_KEY = "brlog.lockHotkey";

/** Default-Hotkey (Auftrag): Strg+Umschalt+L. Deaktiviert bis der Nutzer ihn aktiviert (Opt-in). */
export const DEFAULT_LOCK_HOTKEY = "Ctrl+Shift+L";

export interface LockHotkeySettings {
  enabled: boolean;
  accelerator: string;
}

/** Liest die gespeicherte Einstellung; ohne Bestand: Default-Kombination, deaktiviert. */
export function getLockHotkeySettings(): LockHotkeySettings {
  const accelerator = localStorage.getItem(ACCEL_KEY) || DEFAULT_LOCK_HOTKEY;
  const enabled = localStorage.getItem(ENABLED_KEY) === "1";
  return { enabled, accelerator };
}

function persist(next: LockHotkeySettings): void {
  localStorage.setItem(ACCEL_KEY, next.accelerator);
  localStorage.setItem(ENABLED_KEY, next.enabled ? "1" : "0");
}

// Der eigentliche Sperr-Trigger (App.tsx: prüft `locked` und ruft ggf.
// doLock()) wird EINMAL beim App-Start hinterlegt -- SecurityPanel kennt den
// aktuellen Sperrzustand nicht und braucht ihn auch nicht, es ändert nur die
// Einstellung und stößt eine Neu-Registrierung an (die diesen Trigger wieder
// verwendet).
let trigger: () => void = () => {};

/** Legt fest, was ein Hotkey-Druck auslöst (App.tsx, einmalig beim Mount). */
export function setLockHotkeyTrigger(fn: () => void): void {
  trigger = fn;
}

// Zuletzt beim Plugin registrierter Accelerator (Modulzustand): wird vor
// jeder Neu-Registrierung zuerst gelöst, damit weder ein Kombinations-Wechsel
// noch das Deaktivieren eine verwaiste alte Registrierung zurücklässt.
let registeredAccelerator: string | null = null;

async function loadPlugin() {
  return import("@tauri-apps/plugin-global-shortcut");
}

/**
 * (Re-)registriert den globalen Sofortsperre-Hotkey entsprechend der
 * gespeicherten Einstellung (localStorage). Desktop-only -- auf Android ein
 * No-op (das Plugin existiert dort nicht, s. Cargo.toml/package.json).
 * Wirft bei einem Registrierungsfehler (z. B. Kombination bereits von einer
 * anderen Anwendung belegt) eine Exception mit verständlicher deutscher
 * Meldung; der Aufrufer (SecurityPanel) zeigt sie an und macht die
 * Einstellung rückgängig.
 */
export async function applyLockHotkey(): Promise<void> {
  if (isAndroid()) return;
  const { enabled, accelerator } = getLockHotkeySettings();
  const plugin = await loadPlugin();

  if (registeredAccelerator && registeredAccelerator !== accelerator) {
    await plugin.unregister(registeredAccelerator).catch(() => {});
    registeredAccelerator = null;
  }
  if (!enabled) {
    if (registeredAccelerator) {
      await plugin.unregister(registeredAccelerator).catch(() => {});
      registeredAccelerator = null;
    }
    return;
  }
  if (registeredAccelerator === accelerator) return; // schon aktiv, nichts zu tun

  try {
    await plugin.register(accelerator, (event) => {
      // "Pressed" UND "Released" feuern (Auftrag: Taste drücken sperrt) --
      // nur auf den Druck reagieren, nicht doppelt beim Loslassen.
      if (event.state === "Pressed") trigger();
    });
    registeredAccelerator = accelerator;
  } catch {
    registeredAccelerator = null;
    throw new Error(
      "Diese Tastenkombination ließ sich nicht registrieren -- sie wird vermutlich bereits von einer anderen Anwendung verwendet. Bitte eine andere Kombination wählen."
    );
  }
}

/** Persistiert die Einstellung und registriert den Hotkey neu; wirft bei Registrierungsfehlern. */
export async function setLockHotkeySettings(next: LockHotkeySettings): Promise<void> {
  const previous = getLockHotkeySettings();
  persist(next);
  try {
    await applyLockHotkey();
  } catch (e) {
    persist(previous); // Rollback: Einstellung bleibt auf dem zuletzt funktionierenden Stand
    await applyLockHotkey().catch(() => {});
    throw e;
  }
}
