import { useEffect, useState } from "react";
import {
  changePassword,
  regenerateRecovery,
  getAutoLockMinutes,
  setAutoLockMinutes,
  bioAvailable,
  bioStatus,
  bioEnable,
  bioDisable,
} from "../lib/auth";
import { secondaryBtnSmCls } from "../lib/ui";
import RecoveryCodeReveal from "./RecoveryCodeReveal";
import { Icon } from "./Icon";

interface Props {
  onLockNow: () => void;
  onAutoLockChanged: (minutes: number) => void;
  // Konvention (siehe App.tsx): isAndroid() wird zentral EINMAL in App.tsx
  // ermittelt und als Prop durchgereicht -- hier nur gebraucht, um den
  // Fingerabdruck-Abschnitt auf Android zu gaten (Desktop hat keinen
  // BiometricPrompt, bio_available liefert dort ohnehin available:false,
  // aber der Aufruf selbst spart sich die App auf Desktop komplett).
  mobile: boolean;
}

const LOCK_OPTIONS = [1, 3, 5, 10, 15, 30, 60];

export default function SecurityPanel({ onLockNow, onAutoLockChanged, mobile }: Props) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockMin, setLockMin] = useState(5);

  // Recovery-Code neu erzeugen
  const [rcPw, setRcPw] = useState("");
  const [rcBusy, setRcBusy] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  // Fingerabdruck-Anmeldung (Issue #2, B-UI): nur relevant auf Android UND nur
  // wenn das Gerät Biometrie überhaupt anbietet (bio_available). bioLoading
  // verhindert ein kurzes Aufblitzen des Abschnitts, bevor die Verfügbarkeit
  // feststeht -- ohne Verfügbarkeit bleibt der Abschnitt komplett ausgeblendet
  // (kein toter Hinweis, siehe Auftrag).
  const [bioLoading, setBioLoading] = useState(true);
  const [bioAvail, setBioAvail] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [bioPw, setBioPw] = useState("");
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmingBioDisable, setConfirmingBioDisable] = useState(false);
  const [bioDisableBusy, setBioDisableBusy] = useState(false);

  useEffect(() => {
    getAutoLockMinutes().then(setLockMin);
  }, []);

  useEffect(() => {
    if (!mobile) {
      setBioLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const avail = await bioAvailable();
        if (!active) return;
        setBioAvail(avail.available);
        if (avail.available) {
          const status = await bioStatus();
          if (active) setBioEnrolled(status.enrolled);
        }
      } catch {
        // Best effort -- ohne verlässliche Antwort bleibt der Abschnitt aus.
      } finally {
        if (active) setBioLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mobile]);

  const submitBioEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBioMsg(null);
    setBioBusy(true);
    try {
      await bioEnable(bioPw);
      setBioPw("");
      setBioEnrolled(true);
      setBioMsg({ ok: true, text: "Fingerabdruck-Anmeldung aktiviert." });
    } catch (err) {
      setBioMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBioBusy(false);
    }
  };

  const submitBioDisable = async () => {
    setBioMsg(null);
    setBioDisableBusy(true);
    try {
      await bioDisable();
      setBioEnrolled(false);
      setConfirmingBioDisable(false);
      setBioMsg({ ok: true, text: "Fingerabdruck-Anmeldung deaktiviert." });
    } catch (err) {
      setBioMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBioDisableBusy(false);
    }
  };

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
      setMsg({ ok: true, text: "Passwort geändert. Der Wiederherstellungs-Code bleibt gültig." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRcError(null);
    setRcBusy(true);
    try {
      const code = await regenerateRecovery(rcPw);
      setRcPw("");
      setNewCode(code);
    } catch (err) {
      setRcError(err instanceof Error ? err.message : String(err));
    } finally {
      setRcBusy(false);
    }
  };

  const card =
    "rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800";
  const input =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
  const btn =
    "rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50";
  const outlineBtn = secondaryBtnSmCls;

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
          Wiederherstellungs-Code
        </h4>
        {newCode ? (
          <RecoveryCodeReveal
            code={newCode}
            confirmLabel="Fertig"
            onConfirmed={() => setNewCode(null)}
          />
        ) : (
          <form onSubmit={submitRegenerate} className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Erzeugt einen neuen Code; der alte wird ungültig. Zur Bestätigung das
              aktuelle Passwort eingeben.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Aktuelles Passwort"
              className={input}
              value={rcPw}
              onChange={(e) => setRcPw(e.target.value)}
            />
            <button type="submit" className={outlineBtn} disabled={rcBusy || !rcPw}>
              {rcBusy ? "Wird erzeugt…" : "Neuen Code erzeugen"}
            </button>
            {rcError && (
              <p className="text-sm text-red-600 dark:text-red-400">{rcError}</p>
            )}
          </form>
        )}
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
          Nach dieser Zeit ohne Aktivität sowie beim Minimieren des Fensters wird
          gesperrt. Beim Sperren wird der Entschlüsselungs-Schlüssel aus dem
          Speicher entfernt – die Datei ist dann wieder vollständig verschlüsselt.
        </p>
      </section>

      {/* Fingerabdruck-Anmeldung (Issue #2, B-UI): nur Android UND nur, wenn
          das Gerät Biometrie überhaupt anbietet -- ohne Verfügbarkeit bleibt
          der Abschnitt ganz weg (kein toter Hinweis). bioLoading verhindert
          ein kurzes Aufblitzen, bevor die Prüfung durch ist. */}
      {mobile && !bioLoading && bioAvail && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Fingerabdruck-Anmeldung
          </h4>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Entsperrt die App mit deinem Fingerabdruck. Dein Passwort bleibt
            weiterhin gültig und wird für Änderungen an den
            Sicherheitseinstellungen benötigt.
          </p>
          <p className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Icon name="fingerprint" size={18} />
            Status:{" "}
            <span
              className={
                "font-medium " +
                (bioEnrolled
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-500 dark:text-slate-400")
              }
            >
              {bioEnrolled ? "Aktiviert" : "Nicht aktiviert"}
            </span>
          </p>

          {bioEnrolled ? (
            confirmingBioDisable ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Wirklich deaktivieren?
                </span>
                <button
                  type="button"
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={submitBioDisable}
                  disabled={bioDisableBusy}
                >
                  {bioDisableBusy ? "Wird deaktiviert…" : "Ja, deaktivieren"}
                </button>
                <button
                  type="button"
                  className={outlineBtn}
                  onClick={() => setConfirmingBioDisable(false)}
                  disabled={bioDisableBusy}
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={outlineBtn}
                onClick={() => setConfirmingBioDisable(true)}
              >
                Fingerabdruck-Anmeldung deaktivieren
              </button>
            )
          ) : (
            <form onSubmit={submitBioEnable} className="space-y-2">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Aktuelles Passwort"
                className={input}
                value={bioPw}
                onChange={(e) => setBioPw(e.target.value)}
              />
              <button type="submit" className={btn} disabled={bioBusy || !bioPw}>
                {bioBusy ? "Wird aktiviert…" : "Mit Fingerabdruck-Anmeldung aktivieren"}
              </button>
            </form>
          )}

          {bioMsg && (
            <p
              role="status"
              aria-live="polite"
              className={
                "mt-2 text-sm " +
                (bioMsg.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400")
              }
            >
              {bioMsg.text}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
