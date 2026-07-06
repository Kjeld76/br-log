import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import {
  type StartMode,
  setupEncryption,
  migrate,
  unlockWithPassword,
  unlockWithRecovery,
  validatePasswordPolicy,
  UnlockError,
} from "../lib/auth";
import RecoveryCodeReveal from "../components/RecoveryCodeReveal";

interface Props {
  startMode: StartMode;
  startMessage?: string;
  /** Wird aufgerufen, sobald die DB entsperrt/eingerichtet ist → App freigeben. */
  onUnlocked: () => void;
  // Android (Marios Gerätetest): das Marken-Logo ist aus der mobilen TopBar
  // raus ("würde auch beim Login reichen") und hängt stattdessen hier über
  // der Karte -- NUR mobil, der Desktop-LockScreen bleibt unverändert
  // (dort zeigt weiterhin die Sidebar das Logo nach dem Entsperren).
  mobile?: boolean;
}

/** Ansteigende Sperre: ab dem 3. Fehlversuch 2s,4s,8s … max 30s. */
function backoffSeconds(failCount: number): number {
  if (failCount < 3) return 0;
  return Math.min(30, 2 ** (failCount - 2));
}

export default function LockScreen({
  startMode,
  startMessage,
  onUnlocked,
  mobile = false,
}: Props) {
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Countdown-Ticker, stoppt sich selbst nach Ablauf.
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      if (Date.now() >= lockUntil) window.clearInterval(id);
      force((n) => n + 1);
    }, 250);
    return () => window.clearInterval(id);
  }, [lockUntil]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [startMode, useRecovery]);

  const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
  const locked = remaining > 0;

  const input =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
  const primaryBtn =
    "w-full rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50";

  // Logo dekorativ (alt=""), der Produktname steht als h1 "BR-Log" im
  // jeweiligen Karteninhalt -- Screenreader lesen ihn also weiterhin genau
  // einmal. brand-logo-wrap hält es im Dunkelmodus auf hellem Badge lesbar
  // (dasselbe Muster wie in der Desktop-Sidebar).
  const shell = (children: React.ReactNode) => (
    <div
      className={
        mobile
          ? "flex h-full flex-col items-center justify-center bg-slate-50 p-4 dark:bg-slate-900"
          : "flex h-full items-center justify-center bg-slate-50 p-4 dark:bg-slate-900"
      }
    >
      {mobile && (
        <span className="brand-logo-wrap mb-4">
          <img src={logo} alt="" aria-hidden="true" className="h-10 w-auto" />
        </span>
      )}
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {children}
      </div>
    </div>
  );

  // --- Recovery-Code-Anzeige nach Setup/Migration ---
  if (recoveryCode) {
    return shell(
      <RecoveryCodeReveal
        code={recoveryCode}
        confirmLabel="Weiter zur App"
        onConfirmed={onUnlocked}
      />
    );
  }

  // --- Fehlerzustand (z. B. Keyfile beschädigt) ---
  if (startMode === "error") {
    return shell(
      <div className="space-y-2 text-center">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">BR-Log</h1>
        <p className="font-medium text-red-600 dark:text-red-400">
          Start nicht möglich
        </p>
        <p className="break-all text-sm text-slate-600 dark:text-slate-300">
          {startMessage || "Die Schlüsseldatei konnte nicht gelesen werden."}
        </p>
      </div>
    );
  }

  // --- Verschlüsselte DB vorhanden, aber keyfile.json fehlt (gelöscht/nicht
  // mitkopiert). Bewusst EIGENER Zustand statt firstRun: die App darf die
  // vorhandene, nicht mehr entsperrbare Datenbank auf keinen Fall stillschweigend
  // als "neu" behandeln oder überschreiben. Die Optionen unten sind die
  // tatsächlich verfügbaren – ein Wiederherstellungs-Code allein hilft hier
  // NICHT, weil die dafür nötigen Daten in genau der fehlenden Datei lagen.
  if (startMode === "keyfileMissing") {
    return shell(
      <div className="space-y-3 text-left">
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">BR-Log</h1>
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
            Schlüsseldatei fehlt
          </p>
        </div>
        <p className="break-all text-sm text-slate-600 dark:text-slate-300">
          {startMessage ||
            "Es wurde eine verschlüsselte Datenbank gefunden, aber die zugehörige Schlüsseldatei (keyfile.json) fehlt."}
        </p>
        <button
          type="button"
          className={primaryBtn}
          onClick={() => window.location.reload()}
        >
          Erneut prüfen
        </button>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Nachdem die Schlüsseldatei zurückgelegt wurde, hier klicken oder die
          App neu starten.
        </p>
      </div>
    );
  }

  const isUnlock = startMode === "encrypted";
  const isMigrate = startMode === "needsMigration";

  const handleSetupOrMigrate = async () => {
    setError(null);
    if (pw !== pw2) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    try {
      validatePasswordPolicy(pw);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(true);
    try {
      const code = isMigrate ? await migrate(pw) : await setupEncryption(pw);
      setRecoveryCode(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (locked) return;
    setError(null);
    setBusy(true);
    try {
      if (useRecovery) await unlockWithRecovery(recoveryInput);
      else await unlockWithPassword(pw);
      onUnlocked();
      return;
    } catch (e) {
      const ue = e as UnlockError;
      if (ue && ue.kind === "wrongSecret") {
        const next = fails + 1;
        setFails(next);
        setPw("");
        setRecoveryInput("");
        const wait = backoffSeconds(next);
        if (wait > 0) setLockUntil(Date.now() + wait * 1000);
        setError(wait > 0 ? `Falsch. Bitte ${wait}s warten.` : ue.message);
      } else {
        setError(ue?.message || String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isUnlock) void handleUnlock();
    else void handleSetupOrMigrate();
  };

  const subtitle = isUnlock
    ? "Zum Entsperren Passwort eingeben"
    : isMigrate
      ? "Vorhandene Daten verschlüsseln"
      : "Passwort festlegen";

  return shell(
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-center">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">BR-Log</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>

      {!isUnlock && (
        <p className="rounded bg-sky-50 p-2 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
          {isMigrate
            ? "Die vorhandenen Daten werden jetzt mit SQLCipher (AES-256) verschlüsselt. Eine unverschlüsselte Sicherungskopie wird angelegt; sie kann anschließend über das Menü unter Einstellungen → Datenbank gelöscht werden."
            : "Die Datenbank wird mit SQLCipher (AES-256) verschlüsselt. Ohne Passwort bzw. Wiederherstellungs-Code sind die Daten nicht lesbar."}
        </p>
      )}

      {isUnlock ? (
        useRecovery ? (
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            placeholder="Wiederherstellungs-Code"
            className={input + " font-mono"}
            value={recoveryInput}
            onChange={(e) => setRecoveryInput(e.target.value)}
            disabled={locked}
          />
        ) : (
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            placeholder="Passwort"
            className={input}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={locked}
          />
        )
      ) : (
        <>
          <input
            ref={inputRef}
            type="password"
            autoComplete="new-password"
            placeholder="Passwort (min. 8 Zeichen)"
            className={input}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Passwort wiederholen"
            className={input}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        </>
      )}

      <button
        type="submit"
        className={primaryBtn}
        disabled={
          busy ||
          (isUnlock && (locked || (useRecovery ? !recoveryInput : !pw))) ||
          (!isUnlock && (!pw || !pw2))
        }
      >
        {isUnlock
          ? locked
            ? `Gesperrt – ${remaining}s`
            : busy
              ? "Wird geprüft…"
              : "Entsperren"
          : busy
            ? isMigrate
              ? "Wird verschlüsselt…"
              : "Wird eingerichtet…"
            : isMigrate
              ? "Jetzt verschlüsseln"
              : "Passwort festlegen"}
      </button>

      {isUnlock && (
        <button
          type="button"
          className="w-full text-center text-xs text-sky-700 hover:underline dark:text-sky-300"
          onClick={() => {
            setUseRecovery((v) => !v);
            setError(null);
          }}
        >
          {useRecovery
            ? "Stattdessen Passwort verwenden"
            : "Passwort vergessen? Mit Wiederherstellungs-Code entsperren"}
        </button>
      )}

      {error && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}
