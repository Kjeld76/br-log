// Plattformübergreifendes Theme-Management (Hell / Dunkel / System).

import { FOUC_BG } from "./tokens";

export type Theme = "light" | "dark" | "system";

const KEY = "br-log-theme";

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Nicht exportiert (Finding 51): nur intern von applyTheme genutzt, kein
// externer Aufrufer (Grep-verifiziert).
function isDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && prefersDark());
}

/** Setzt `dark`-Klasse + `data-theme` + sofortige Hintergrundfarbe (deckungsgleich mit dem FOUC-Script). */
export function applyTheme(theme: Theme): void {
  const dark = isDark(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.backgroundColor = dark ? FOUC_BG.dark : FOUC_BG.light;
  void syncWindowTheme(theme);
}

/** Native Fenster-/Titelleisten-Theme (best effort; benötigt core:window:allow-set-theme). */
async function syncWindowTheme(theme: Theme): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme === "system" ? null : theme);
  } catch {
    // außerhalb von Tauri oder ohne Berechtigung -> ignorieren
  }
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/** Bei „System" auf OS-Wechsel reagieren. Gibt eine Cleanup-Funktion zurück. */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
