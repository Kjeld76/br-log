import { useEffect, useRef, useState } from "react";
import { isPasswordSet, setupPassword, verifyPassword } from "../lib/auth";

interface Props {
  /** Wird nach erfolgreichem Setup/Unlock aufgerufen → App freigeben. */
  onUnlocked: () => void;
}

/** Ansteigende Sperre: ab dem 3. Fehlversuch 2s,4s,8s … max 30s. */
function backoffSeconds(failCount: number): number {
  if (failCount < 3) return 0;
  return Math.min(30, 2 ** (failCount - 2));
}

export default function LockScreen({ onUnlocked }: Props) {
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0); // epoch ms
  const [, force] = useState(0); // re-render für Countdown
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isPasswordSet().then((set) => setMode(set ? "unlock" : "setup"));
  }, []);

  // Countdown-Ticker, solange eine Sperre aktiv ist. Stoppt sich selbst, sobald
  // die Sperrzeit abgelaufen ist (sonst läuft das Interval endlos weiter).
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
  }, [mode]);

  const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
  const locked = remaining > 0;

  const handleSetup = async () => {
    setError(null);
    if (pw !== pw2) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      await setupPassword(pw);
      onUnlocked();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (locked) return;
    setError(null);
    setBusy(true);
    try {
      const ok = await verifyPassword(pw);
      if (ok) {
        onUnlocked();
        return;
      }
      const next = fails + 1;
      setFails(next);
      setPw("");
      const wait = backoffSeconds(next);
      if (wait > 0) setLockUntil(Date.now() + wait * 1000);
      setError(
        wait > 0 ? `Falsches Passwort. Bitte ${wait}s warten.` : "Falsches Passwort."
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "setup") void handleSetup();
    else void handleUnlock();
  };

  const input =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
  const primaryBtn =
    "w-full rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50";

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4 dark:bg-slate-900">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            BR-Log
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === "loading"
              ? ""
              : mode === "setup"
                ? "Passwort festlegen"
                : "Passwort eingeben zum Entsperren"}
          </p>
        </div>

        {mode === "loading" && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Wird geladen…
          </p>
        )}

        {mode === "setup" && (
          <>
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Hinweis: Dieses Passwort schützt nur den App-Zugang. Die
              Datenbank-Datei bleibt in dieser Version unverschlüsselt. Eine echte
              Verschlüsselung folgt in einer späteren Version.
            </p>
            <input
              ref={inputRef}
              type="password"
              autoComplete="new-password"
              placeholder="Neues Passwort (min. 8 Zeichen)"
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
            <button
              type="submit"
              className={primaryBtn}
              disabled={busy || !pw || !pw2}
            >
              {busy ? "Wird gespeichert…" : "Passwort festlegen"}
            </button>
          </>
        )}

        {mode === "unlock" && (
          <>
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
            <button
              type="submit"
              className={primaryBtn}
              disabled={busy || locked || !pw}
            >
              {locked
                ? `Gesperrt – ${remaining}s`
                : busy
                  ? "Wird geprüft…"
                  : "Entsperren"}
            </button>
          </>
        )}

        {error && (
          <p className="text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
