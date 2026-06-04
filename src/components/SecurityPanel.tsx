import { useEffect, useState } from "react";
import {
  changePassword,
  getAutoLockMinutes,
  setAutoLockMinutes,
} from "../lib/auth";

interface Props {
  onLockNow: () => void;
  onAutoLockChanged: (minutes: number) => void;
}

const LOCK_OPTIONS = [1, 3, 5, 10, 15, 30, 60];

export default function SecurityPanel({ onLockNow, onAutoLockChanged }: Props) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockMin, setLockMin] = useState(5);

  useEffect(() => {
    getAutoLockMinutes().then(setLockMin);
  }, []);

  const changeLock = async (min: number) => {
    setLockMin(min);
    await setAutoLockMinutes(min);
    onAutoLockChanged(min);
  };

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (newPw !== newPw2) {
      setMsg({ ok: false, text: "Die neuen Passwörter stimmen nicht überein." });
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setNewPw2("");
      setMsg({ ok: true, text: "Passwort geändert." });
    } catch (err) {
      setMsg({
        ok: false,
        text: String(err instanceof Error ? err.message : err),
      });
    } finally {
      setBusy(false);
    }
  };

  const card =
    "rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800";
  const input =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
  const btn =
    "rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50";
  const outlineBtn =
    "rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div className="space-y-5">
      <section className={card}>
        <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Passwort ändern
        </h4>
        <form onSubmit={submitPw} className="space-y-2">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Aktuelles Passwort"
            className={input}
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Neues Passwort (min. 8 Zeichen)"
            className={input}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Neues Passwort wiederholen"
            className={input}
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
          <button type="submit" className={btn} disabled={busy || !oldPw || !newPw}>
            {busy ? "Wird geändert…" : "Passwort ändern"}
          </button>
          {msg && (
            <p
              className={
                "text-sm " +
                (msg.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {msg.text}
            </p>
          )}
        </form>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Automatische Sperre
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            Nach Inaktivität sperren:
          </label>
          <select
            className={input + " w-auto"}
            value={lockMin}
            onChange={(e) => void changeLock(parseInt(e.target.value, 10))}
          >
            {LOCK_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} Minuten
              </option>
            ))}
          </select>
          <button type="button" className={outlineBtn} onClick={onLockNow}>
            Jetzt sperren
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Der App-Zugang wird nach dieser Zeit ohne Aktivität sowie beim
          Minimieren des Fensters gesperrt. Hinweis: In dieser Version schützt das
          Passwort nur den App-Zugang, nicht die Datenbank-Datei selbst.
        </p>
      </section>
    </div>
  );
}
