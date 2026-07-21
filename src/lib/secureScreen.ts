// Screenshot-/Vorschau-Schutz zur Laufzeit (Issue #17, Task 7) -- NUR Android.
// Der eigentliche Schutz (FLAG_SECURE) ist in MainActivity.onCreate PER
// DEFAULT gesetzt und hängt NICHT von dieser Datei ab (siehe dortiger
// Kommentar: "darf NIE vom Runtime-Toggle abhängen"). Diese Datei erlaubt nur
// das spätere Abschalten laut Nutzereinstellung über den Rust-Command
// set_secure_screen -> Kotlin-Plugin (biometric-unlock, zweiter Command
// neben den bio_*-Funktionen). Reine IO (localStorage + invoke), analog zu
// lockHotkey.ts -- bewusst ohne eigenen Test (wie dort).

import { invoke } from "@tauri-apps/api/core";
import { isAndroid } from "./platform";

const STORAGE_KEY = "brlog.secureScreen";

/** Default AN (Auftrag): der Schutz ist die sichere Voreinstellung. */
export function getSecureScreenEnabled(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === "1";
}

function persist(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

/**
 * Persistiert die Einstellung und wendet sie sofort an (Command
 * set_secure_screen). Auf Desktop ein No-op (kein FLAG_SECURE-Konzept; die UI
 * blendet den Abschnitt dort ohnehin aus, s. SecurityPanel).
 */
export async function setSecureScreenEnabled(enabled: boolean): Promise<void> {
  persist(enabled);
  if (!isAndroid()) return;
  await invoke("set_secure_screen", { enabled });
}

/**
 * Wendet die gespeicherte Einstellung an. Aufrufer (App.tsx) ruft dies NACH
 * dem Entsperren auf (Auftrag: "vorher gilt sicherheitshalber immer AN", s.
 * MainActivity.onCreate-Default). No-op auf Desktop.
 */
export async function applySecureScreenSetting(): Promise<void> {
  if (!isAndroid()) return;
  await invoke("set_secure_screen", { enabled: getSecureScreenEnabled() });
}
