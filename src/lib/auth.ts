// Passwort-Gate Phase 1 (UI-Login, KEINE DB-Verschlüsselung).
// Speichert ausschließlich einen Argon2id-PHC-String (Hash + Salt + Parameter)
// in keyfile.json im Datenverzeichnis (neben der DB) – nie das Klartext-Passwort.
// Argon2 läuft in Rust.
//
// Warum keyfile.json (nicht in der DB): Phase 2 (SQLCipher) verschlüsselt die DB;
// das Auth-Material muss VOR dem Entschlüsseln lesbar sein. Die Keyfile liegt
// außerhalb der DB (im selben Ordner -> wandert im portablen Modus mit) und wird
// in Phase 2 um das Key-Wrapping (gekapselte DEK) erweitert.
//
// WICHTIG: Das Gate schützt nur den App-Zugang, NICHT die Datei. Echte
// Vertraulichkeit erst mit Phase 2 (Verschlüsselung).

import { invoke } from "@tauri-apps/api/core";

interface Keyfile {
  version: number;
  argon2: string; // PHC-String (Hash + Salt + Parameter)
  autoLockMinutes: number;
}

const KEYFILE_VERSION = 1;
const DEFAULT_AUTOLOCK_MIN = 5;
const MIN_AUTOLOCK_MIN = 1;
const MAX_AUTOLOCK_MIN = 120;

// Session-Cache der Keyfile (einziger Storage-Berührpunkt).
// undefined = noch nicht geladen, null = keine Keyfile vorhanden.
let cache: Keyfile | null | undefined;

async function readKeyfile(): Promise<Keyfile | null> {
  if (cache !== undefined) return cache;
  const raw = await invoke<string | null>("auth_read");
  if (raw === null) {
    // Datei existiert nicht -> noch kein Passwort gesetzt (Setup ist legitim).
    cache = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Keyfile;
    if (!parsed || typeof parsed.argon2 !== "string" || !parsed.argon2) {
      throw new Error("unvollständig");
    }
    cache = parsed;
    return cache;
  } catch {
    // Datei existiert, ist aber kaputt/leer -> NICHT als "kein Passwort" behandeln,
    // sonst erschiene der Setup-Screen und ein neues Passwort könnte das alte Gate
    // überschreiben. Stattdessen klaren Fehler werfen (App zeigt Startfehler).
    throw new Error(
      "Die Schlüsseldatei (keyfile.json) ist beschädigt oder unvollständig. " +
        "Bitte aus einem Backup wiederherstellen."
    );
  }
}

async function writeKeyfile(kf: Keyfile): Promise<void> {
  // Cache erst NACH erfolgreichem Schreiben setzen, damit In-Memory- und
  // Platten-Zustand bei einem Schreibfehler nicht auseinanderlaufen.
  await invoke("auth_write", { content: JSON.stringify(kf, null, 2) });
  cache = kf;
}

// --- öffentliche API --------------------------------------------------------

/** True, wenn bereits ein Passwort festgelegt wurde. */
export async function isPasswordSet(): Promise<boolean> {
  const kf = await readKeyfile();
  return !!kf && typeof kf.argon2 === "string" && kf.argon2.length > 0;
}

/** Legt erstmalig ein Passwort fest (Ersteinrichtung). */
export async function setupPassword(password: string): Promise<void> {
  if (await isPasswordSet()) {
    throw new Error("Es ist bereits ein Passwort gesetzt.");
  }
  validatePasswordPolicy(password);
  const phc = await invoke<string>("argon2_hash", { password });
  await writeKeyfile({
    version: KEYFILE_VERSION,
    argon2: phc,
    autoLockMinutes: DEFAULT_AUTOLOCK_MIN,
  });
}

/** Prüft ein Passwort gegen den gespeicherten Argon2id-Hash. */
export async function verifyPassword(password: string): Promise<boolean> {
  const kf = await readKeyfile();
  if (!kf || !kf.argon2) return false;
  return invoke<boolean>("argon2_verify", { password, phc: kf.argon2 });
}

/** Ändert das Passwort. Das alte muss korrekt sein. */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const kf = await readKeyfile();
  if (!kf || !(await verifyPassword(oldPassword))) {
    throw new Error("Das aktuelle Passwort ist falsch.");
  }
  validatePasswordPolicy(newPassword);
  const phc = await invoke<string>("argon2_hash", { password: newPassword });
  await writeKeyfile({ ...kf, version: KEYFILE_VERSION, argon2: phc });
}

/** Mindest-Policy für das Passwort (bewusst schlank in Phase 1). */
export function validatePasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
  }
}

// --- Auto-Lock-Dauer --------------------------------------------------------

export async function getAutoLockMinutes(): Promise<number> {
  const kf = await readKeyfile();
  const n = kf ? kf.autoLockMinutes : NaN;
  if (Number.isFinite(n) && n >= MIN_AUTOLOCK_MIN && n <= MAX_AUTOLOCK_MIN) {
    return n;
  }
  return DEFAULT_AUTOLOCK_MIN;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const kf = await readKeyfile();
  if (!kf) return; // ohne Passwort existiert keine Keyfile
  const clamped = Math.min(
    MAX_AUTOLOCK_MIN,
    Math.max(MIN_AUTOLOCK_MIN, Math.round(minutes))
  );
  await writeKeyfile({ ...kf, autoLockMinutes: clamped });
}

// --- Inaktivitäts-/Auto-Lock-Timer -----------------------------------------

/**
 * Startet einen Inaktivitäts-Timer. Ruft `onLock()` auf, wenn `minutes` lang
 * keine Nutzeraktivität (Maus/Tasten/Touch/Fokus) registriert wurde.
 * Gibt eine Cleanup-Funktion zurück (analog watchSystemTheme in theme.ts).
 */
export function startIdleTimer(minutes: number, onLock: () => void): () => void {
  const ms = Math.max(MIN_AUTOLOCK_MIN, minutes) * 60_000;
  let timer: number | undefined;

  const reset = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(onLock, ms);
  };

  const events: (keyof WindowEventMap)[] = [
    "mousemove",
    "mousedown",
    "keydown",
    "wheel",
    "touchstart",
    "focus",
  ];
  for (const ev of events) {
    window.addEventListener(ev, reset, { passive: true });
  }
  reset(); // sofort scharf schalten

  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    for (const ev of events) window.removeEventListener(ev, reset);
  };
}
