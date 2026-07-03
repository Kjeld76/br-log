// Einzige Stelle für Plattform-Weichen im Frontend (Linux-Portierung). Der
// restliche Code fragt NIE direkt `platform()` aus @tauri-apps/plugin-os ab,
// sondern immer eine der Funktionen hier -- so bleibt die Erkennung an einer
// Stelle wart- und testbar (auch für den späteren Android-Arm).
import { platform } from "@tauri-apps/plugin-os";

/**
 * Liest die Plattform robust aus. `platform()` (v2, synchron) liest intern aus
 * `window.__TAURI_OS_PLUGIN_INTERNALS__`, das nur gesetzt ist, wenn das Plugin
 * in einer echten Tauri-Webview initialisiert wurde. Außerhalb einer Tauri-
 * Umgebung (z. B. ein Aufruf ohne vorherigen vi.mock in einem Test) wirft der
 * Aufruf eine Exception -- dann greift der Fallback auf "windows" (bisher
 * einzige produktive Plattform), statt die App abstürzen zu lassen. In echten
 * Tests wird "@tauri-apps/plugin-os" per vi.mock ersetzt (siehe
 * platform.test.ts); der Mock-Rückgabewert läuft dann ganz normal durch diese
 * Funktion durch.
 */
function detectPlatform(): string {
  try {
    return platform();
  } catch {
    return "windows";
  }
}

export function isWindows(): boolean {
  return detectPlatform() === "windows";
}

export function isLinux(): boolean {
  return detectPlatform() === "linux";
}

export function isAndroid(): boolean {
  return detectPlatform() === "android";
}

/** Desktop = alles außer Android (der einzige aktuell relevante Nicht-Desktop-Fall). */
export function isDesktop(): boolean {
  return !isAndroid();
}
