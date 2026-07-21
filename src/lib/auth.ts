// Verschlüsselter Login (Issue #1, Phase 2). Die DB ist mit SQLCipher
// verschlüsselt; entsperrt wird mit Passwort ODER Recovery-Code. Die gesamte
// Krypto (DEK, Key-Wrapping, Argon2id) läuft in Rust – hier nur dünne
// Command-Wrapper. Nichts Geheimes (Passwort, Code, Schlüssel) wird im
// Frontend gespeichert.

import { invoke } from "@tauri-apps/api/core";
import { AppError } from "./errors";

const MIN_AUTOLOCK_MIN = 1;
const MAX_AUTOLOCK_MIN = 120;
// Sentinel „nie automatisch sperren" (Issue #17). Bewusst kein Teil des
// 1..120-Bereichs -- 0 ist ein eigenständiger, dritter Zustand (siehe
// startIdleTimer/getAutoLockMinutes/setAutoLockMinutes unten), keine weitere
// Untergrenze. Die UI (SecurityPanel) begrenzt NEUE manuelle Eingaben auf
// 1-60 Minuten -- diese Datei hier bleibt bewusst bei 120 als Obergrenze,
// damit Bestandswerte aus der Zeit vor dieser Beschränkung (bis 120) beim
// Lesen (getAutoLockMinutes) weiterhin unverändert durchgereicht werden.
const NEVER_AUTOLOCK_MIN = 0;

export type StartMode =
  | "firstRun" // keine DB -> Erst-Einrichtung
  | "needsMigration" // Klartext-DB -> verschlüsseln
  | "encrypted" // verschlüsselte DB -> entsperren
  | "keyfileMissing" // verschlüsselte DB vorhanden, aber keyfile.json fehlt
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
    throw new AppError("Das Passwort muss mindestens 8 Zeichen lang sein.");
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
  if (n === NEVER_AUTOLOCK_MIN) return n;
  if (Number.isFinite(n) && n >= MIN_AUTOLOCK_MIN && n <= MAX_AUTOLOCK_MIN) return n;
  return 5;
}

/**
 * Klemmt wie Rust (crypto::clamp_autolock_minutes): EXAKT 0 bleibt der
 * Sentinel „nie" (der Aufrufer -- SecurityPanel -- sendet ihn gezielt über
 * die "Nie automatisch sperren"-Option, nicht über das Minutenfeld). Jeder
 * andere Wert, auch einer, der erst durch Rundung bei 0 landet (z. B. 0.4)
 * oder negativ ist, wird stattdessen auf die Untergrenze 1 angehoben --
 * ein Rundungsartefakt darf die Auto-Sperre nicht stillschweigend abschalten.
 */
function clampAutoLockMinutes(minutes: number): number {
  if (minutes === NEVER_AUTOLOCK_MIN) return NEVER_AUTOLOCK_MIN;
  const rounded = Math.round(minutes);
  if (rounded <= NEVER_AUTOLOCK_MIN) return MIN_AUTOLOCK_MIN;
  return Math.min(MAX_AUTOLOCK_MIN, Math.max(MIN_AUTOLOCK_MIN, rounded));
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const clamped = clampAutoLockMinutes(minutes);
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
 *
 * Sentinel `minutes <= 0` (siehe NEVER_AUTOLOCK_MIN): „nie automatisch
 * sperren" -- echtes No-op, es wird WEDER ein Timer gestartet NOCH ein
 * Aktivitäts-Listener registriert. Die zurückgegebene Cleanup-Funktion bleibt
 * trotzdem eine funktionierende Funktion (Aufrufer -- App.tsx -- ruft sie
 * unbedingt im useEffect-Cleanup auf). WICHTIG: die Sperre beim Verstecken/
 * Minimieren der App (visibilitychange-Handler in App.tsx) ist ein davon
 * komplett unabhängiger, bewusster Mechanismus und bleibt von diesem Sentinel
 * UNBERÜHRT -- nur die Inaktivitäts-Sperre lässt sich hierüber abschalten.
 */
export function startIdleTimer(minutes: number, onLock: () => void): () => void {
  if (minutes <= NEVER_AUTOLOCK_MIN) {
    return () => {};
  }
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

// --- Biometrie-Entsperren (Issue #2, B-UI) ---
//
// Dünne Wrapper um die drei bio_*-Commands (siehe B-Core, lib.rs): bio_status/
// bio_available sind infallibel (liefern nie ein Err), bio_enable/bio_disable
// liefern bei Fehlschlag bereits einen fertigen deutschen Text (Result<(),
// String>) -- der wird unverändert in eine AppError verpackt (gleiches Muster
// wie validatePasswordPolicy oben), damit toUserMessage ihn durchreicht statt
// generisch zu wrappen. unlockWithBiometric liefert bei Fehlschlag einen
// strukturierten BioError (kind), analog zu UnlockError -- die UI (LockScreen)
// reagiert je nach kind unterschiedlich (still bei Abbruch, Hinweis bei
// Lockout/Ungültigkeit, Rückfall auf Passwort bei keyInvalidated).

export interface BioStatus {
  enrolled: boolean;
}

export interface BioAvailability {
  available: boolean;
  reason?: string | null;
}

export type BioErrorKind =
  | "keyInvalidated"
  | "canceled"
  | "lockout"
  | "unavailable"
  | "other";

/** Strukturierter bio_unlock-Fehler: nur `kind` entscheidet, wie die UI reagiert. */
export class BioError extends Error {
  kind: BioErrorKind;
  constructor(kind: BioErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function toBioError(e: unknown): BioError {
  const obj = e as { kind?: string; message?: string } | null;
  const kind: BioErrorKind =
    obj?.kind === "keyInvalidated" ||
    obj?.kind === "canceled" ||
    obj?.kind === "lockout" ||
    obj?.kind === "unavailable" ||
    obj?.kind === "other"
      ? obj.kind
      : "other";
  const message =
    obj?.message ||
    (typeof e === "string" ? e : "Fingerabdruck-Entsperren fehlgeschlagen.");
  return new BioError(kind, message);
}

function toBioAppError(e: unknown): AppError {
  return new AppError(
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
  );
}

/** Liest, ob im keyfile ein bio-Wrap hinterlegt ist (plattformunabhängig). */
export function bioStatus(): Promise<BioStatus> {
  return invoke<BioStatus>("bio_status");
}

/** Fragt Keystore/BiometricManager ab (Desktop liefert immer available:false). */
export function bioAvailable(): Promise<BioAvailability> {
  return invoke<BioAvailability>("bio_available");
}

/**
 * Aktiviert Fingerabdruck-Entsperren: das Passwort wird verifiziert (entkapselt
 * die DEK wie crypto_unlock), der native BiometricPrompt kapselt sie danach neu
 * im Android-Keystore.
 */
export async function bioEnable(password: string): Promise<void> {
  try {
    await invoke("bio_enable", { password });
  } catch (e) {
    throw toBioAppError(e);
  }
}

/**
 * Entsperrt mit Fingerabdruck (zeigt den nativen BiometricPrompt). Bei Erfolg
 * ist die DB entsperrt -- exakt derselbe Zustand wie nach unlockWithPassword/
 * unlockWithRecovery.
 */
export async function unlockWithBiometric(): Promise<void> {
  try {
    await invoke("bio_unlock");
  } catch (e) {
    throw toBioError(e);
  }
}

/** Deaktiviert Fingerabdruck-Entsperren: Keystore-Key UND bio-Wrap im keyfile weg. */
export async function bioDisable(): Promise<void> {
  try {
    await invoke("bio_disable");
  } catch (e) {
    throw toBioAppError(e);
  }
}
