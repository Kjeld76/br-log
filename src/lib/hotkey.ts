// Reine Helfer für den globalen Sofortsperre-Hotkey (Issue #17, Desktop-only,
// s. lockHotkey.ts für die Registrierung über @tauri-apps/plugin-global-
// shortcut). Zwei pure Funktionen, unabhängig von Tauri/DOM testbar:
//  - acceleratorFromEvent: Aufnahme-Feld (SecurityPanel) -> Accelerator-String.
//  - formatAccelerator: Accelerator-String -> deutsche Anzeige.
//
// Format-Kompatibilität: `global_hotkey::hotkey::parse_hotkey` (Rust, hinter
// tauri-plugin-global-shortcut) akzeptiert Modifier case-insensitiv als
// "CTRL"/"ALT"/"SHIFT"/"SUPER" (KEIN "META" -- deshalb wird die Meta-/
// Befehlstaste unten auf "Super" abgebildet) und die Haupttaste über
// `parse_key`, das u. a. exakt die W3C-UI-Events-`KeyboardEvent.code`-Werte
// kennt ("KeyL"/"L", "Digit5"/"5", "ArrowUp", "F1", "Comma", …) -- deshalb
// wird `event.code` hier nur um das "Key"/"Digit"-Präfix gekürzt (liefert die
// von den Tests erwartete kurze Form "L"/"5") und sonst unverändert
// übernommen, statt eine eigene vollständige Übersetzungstabelle zu pflegen.

/** Physische Modifier-Tasten selbst (per `code`) -- kein gültiger Haupttaste. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft", // Firefox: Meta-/Windows-Taste
  "OSRight",
]);

function mainKeyToken(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

/**
 * Baut aus einem Tastatur-Event (Aufnahme-Feld) einen Accelerator-String für
 * tauri-plugin-global-shortcut, z. B. "Ctrl+Shift+L". Verlangt mindestens
 * einen der Modifier Ctrl/Alt/Meta (Shift ALLEIN erfüllt die Pflicht nicht,
 * siehe Auftrag) UND eine Nicht-Modifier-Taste -- sonst `null`.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  // metaKey (Windows-/Befehlstaste) -> "Super": global-hotkey kennt keinen
  // Modifier-Token "Meta" (nur "Super"/"Cmd"/"Command"), s. Kommentar oben.
  if (e.metaKey) parts.push("Super");
  parts.push(mainKeyToken(e.code));
  return parts.join("+");
}

/** Modifier-Token -> deutsche Anzeige; alles andere (Alt, Super, Tasten) bleibt unverändert. */
const DISPLAY_REPLACEMENTS: Record<string, string> = {
  Ctrl: "Strg",
  Shift: "Umschalt",
};

/** Deutsche Anzeige eines gespeicherten Accelerators, z. B. "Ctrl+Shift+L" -> "Strg+Umschalt+L". */
export function formatAccelerator(acc: string): string {
  return acc
    .split("+")
    .map((token) => DISPLAY_REPLACEMENTS[token] ?? token)
    .join("+");
}
