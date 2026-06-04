// Verschlüsselter Login (Issue #1, Phase 2). Die DB ist mit SQLCipher
// verschlüsselt; entsperrt wird mit Passwort ODER Recovery-Code. Die gesamte
// Krypto (DEK, Key-Wrapping, Argon2id) läuft in Rust – hier nur dünne
// Command-Wrapper. Nichts Geheimes (Passwort, Code, Schlüssel) wird im
// Frontend gespeichert.

import { invoke } from "@tauri-apps/api/core";

const MIN_AUTOLOCK_MIN = 1;
const MAX_AUTOLOCK_MIN = 120;

export type StartMode =
  | "firstRun" // keine DB -> Erst-Einrichtung
  | "needsMigration" // Klartext-DB -> verschlüsseln
  | "encrypted" // verschlüsselte DB -> entsperren
  | "error"; // Keyfile beschädigt o. Ä.

export interface StartStatus {
  mode: StartMode;
  autoLockMinutes: number;
  message?: string;
}

export type UnlockErrorKind = "wrongSecret" | "corrupt" | "dbError";

/** Strukturierter Entsperr-Fehler: nur `wrongSecret` löst Backoff aus. */
export class UnlockError extends Error {
  kind: UnlockErrorKind;
  constructor(kind: UnlockErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function toUnlockError(e: unknown): UnlockError {
  const obj = e as { kind?: string; message?: string } | null;
  const kind: UnlockErrorKind =
    obj?.kind === "wrongSecret" || obj?.kind === "corrupt" || obj?.kind === "dbError"
      ? obj.kind
      : "dbError";
  const message =
    kind === "wrongSecret"
      ? "Falsches Passwort bzw. Wiederherstellungs-Code."
      : obj?.message || (typeof e === "string" ? e : "Entsperren fehlgeschlagen.");
  return new UnlockError(kind, message);
}

let statusCache: StartStatus | undefined;

/** Startentscheidung vom Rust-Backend (firstRun/needsMigration/encrypted/error). */
export async function getStartStatus(): Promise<StartStatus> {
  if (statusCache) return statusCache;
  statusCache = await invoke<StartStatus>("db_status");
  return statusCache;
}

function invalidateStatus() {
  statusCache = undefined;
}

/** Mindest-Policy für das Passwort (bewusst schlank). */
export function validatePasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
  }
}

/**
 * Erst-Einrichtung (keine bestehende DB): legt eine neue verschlüsselte DB an.
 * Gibt den Recovery-Code (Anzeigeform) zurück – nur hier einmalig.
 */
export async function setupEncryption(password: string): Promise<string> {
  validatePasswordPolicy(password);
  const r = await invoke<{ recoveryCode: string }>("crypto_setup", { password });
  invalidateStatus();
  return r.recoveryCode;
}

/**
 * Migration einer bestehenden Klartext-DB in eine verschlüsselte. `password`
 * ist das neue Passwort. Gibt den Recovery-Code zurück.
 */
export async function migrate(password: string): Promise<string> {
  validatePasswordPolicy(password);
  const r = await invoke<{ recoveryCode: string }>("crypto_migrate", { password });
  invalidateStatus();
  return r.recoveryCode;
}

async function doUnlock(secret: string, kind: "password" | "recovery"): Promise<void> {
  try {
    await invoke("crypto_unlock", { secret, kind });
  } catch (e) {
    throw toUnlockError(e);
  }
}

export function unlockWithPassword(password: string): Promise<void> {
  return doUnlock(password, "password");
}

export function unlockWithRecovery(code: string): Promise<void> {
  return doUnlock(code, "recovery");
}

/** Sperren: Rust dropt die Connection und verwirft den Schlüssel aus dem RAM. */
export async function lock(): Promise<void> {
  await invoke("crypto_lock");
}

/** Passwort ändern (DEK wird nur neu gekapselt; Recovery-Code bleibt gültig). */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  validatePasswordPolicy(newPassword);
  try {
    await invoke("crypto_change_password", { oldPassword, newPassword });
  } catch (e) {
    throw toUnlockError(e);
  }
}

/** Neuen Recovery-Code erzeugen (altes Passwort bestätigt Besitz). */
export async function regenerateRecovery(password: string): Promise<string> {
  try {
    const r = await invoke<{ recoveryCode: string }>("crypto_regenerate_recovery", {
      password,
    });
    return r.recoveryCode;
  } catch (e) {
    throw toUnlockError(e);
  }
}

// --- Auto-Lock-Dauer ---

export async function getAutoLockMinutes(): Promise<number> {
  const s = await getStartStatus();
  const n = s.autoLockMinutes;
  if (Number.isFinite(n) && n >= MIN_AUTOLOCK_MIN && n <= MAX_AUTOLOCK_MIN) return n;
  return 5;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const clamped = Math.min(
    MAX_AUTOLOCK_MIN,
    Math.max(MIN_AUTOLOCK_MIN, Math.round(minutes))
  );
  await invoke("crypto_set_autolock", { minutes: clamped });
  invalidateStatus();
}

/** Klartext-Backup (.pre-encrypt.bak) nach bestätigter Migration löschen. */
export async function deletePlaintextBackup(): Promise<void> {
  await invoke("delete_plaintext_backup");
}

// --- Inaktivitäts-/Auto-Lock-Timer ---

/**
 * Startet einen Inaktivitäts-Timer. Ruft `onLock()` nach `minutes` ohne
 * Aktivität (Maus/Tasten/Touch/Fokus). Gibt eine Cleanup-Funktion zurück.
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
  for (const ev of events) window.addEventListener(ev, reset, { passive: true });
  reset();
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    for (const ev of events) window.removeEventListener(ev, reset);
  };
}
