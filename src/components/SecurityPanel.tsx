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
import TagChip from "./TagChip";
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

// Schnellklick-Chips für die Auto-Sperre-Minuten (Issue #17): waren bis
// v1.8.0 die einzige Auswahl (Dropdown mit genau diesen sieben Werten),
// bleiben jetzt als Presets neben dem freien 1-60-Eingabefeld erhalten --
// alle sieben Werte liegen ohnehin innerhalb der neuen 1-60-Grenze.
const LOCK_OPTIONS = [1, 3, 5, 10, 15, 30, 60];
const MIN_LOCK_INPUT = 1;
const MAX_LOCK_INPUT = 60;
// Sentinel „nie automatisch sperren" (siehe lib/auth.ts NEVER_AUTOLOCK_MIN) --
// identischer Wert, hier lokal benannt, damit diese Datei nicht den
// modulinternen Namen aus auth.ts importieren muss (der ist bewusst nicht
// exportiert, s. dortiger Kommentar).
const NEVER_LOCK = 0;
const DEFAULT_LOCK_MIN = 5;

export default function SecurityPanel({ onLockNow, onAutoLockChanged, mobile }: Props) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // lockMin: 0 == "nie" (NEVER_LOCK), sonst Minuten (auch > 60 möglich bei
  // Bestandswerten von vor dieser 1-60-UI-Begrenzung -- Rust toleriert bis
  // 120, s. crypto::clamp_autolock_minutes). draftMinutes hält den zuletzt
  // bekannten POSITIVEN Wert als String fürs Eingabefeld -- getrennt von
  // lockMin, damit beim Umschalten auf "Nie" und zurück wieder der vorherige
  // Minutenwert erscheint, statt auf den Default zurückzufallen.
  const [lockMin, setLockMin] = useState(DEFAULT_LOCK_MIN);
  const [draftMinutes, setDraftMinutes] = useState(String(DEFAULT_LOCK_MIN));

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
    getAutoLockMinutes().then((m) => {
      setLockMin(m);
      if (m > NEVER_LOCK) setDraftMinutes(String(m));
    });
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
    if (min > NEVER_LOCK) setDraftMinutes(String(min));
    await setAutoLockMinutes(min);
    onAutoLockChanged(min);
  };

  // Zahleneingabe (1-60): live übernehmen, sobald der eingetippte Wert
  // gültig ist -- ungültige Zwischenzustände beim Tippen (leer, "0", außerhalb
  // des Bereichs) lösen bewusst KEINEN Backend-Aufruf aus, sondern werden erst
  // beim Verlassen des Felds (onBlur) auf den zuletzt gültigen Wert
  // zurückgesetzt. Verhindert, dass ein Rundungsartefakt oder eine
  // Zwischeneingabe die Auto-Sperre stillschweigend verändert.
  const onMinutesInputChange = (raw: string) => {
    setDraftMinutes(raw);
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= MIN_LOCK_INPUT && n <= MAX_LOCK_INPUT) {
      void changeLock(n);
    }
  };
  const onMinutesInputBlur = () => {
    setDraftMinutes(String(lockMin > NEVER_LOCK ? lockMin : DEFAULT_LOCK_MIN));
  };
  const toggleNeverLock = () => {
    if (lockMin === NEVER_LOCK) {
      const restore = parseInt(draftMinutes, 10);
      const clamped =
        Number.isFinite(restore) && restore >= MIN_LOCK_INPUT && restore <= MAX_LOCK_INPUT
          ? restore
          : DEFAULT_LOCK_MIN;
      void changeLock(clamped);
    } else {
      void changeLock(NEVER_LOCK);
    }
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

  const card = "rounded border border-border bg-surface p-4";
  const input =
    "w-full rounded border border-border-strong bg-login-input px-3 py-2 text-sm text-primary-ink outline-none focus:border-focus";
  const btn =
    "rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50";
  const outlineBtn = secondaryBtnSmCls;

  return (
    <div className="space-y-5">
      <section className={card}>
        <h4 className="mb-2 text-sm font-semibold text-primary-ink">
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
                (msg.ok ? "text-success" : "text-danger-ink")
              }
            >
              {msg.text}
            </p>
          )}
        </form>
      </section>

      <section className={card}>
        <h4 className="mb-2 text-sm font-semibold text-primary-ink">
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
            <p className="text-xs text-secondary-ink">
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
              <p className="text-sm text-danger-ink">{rcError}</p>
            )}
          </form>
        )}
      </section>

      <section className={card}>
        <h4 className="mb-2 text-sm font-semibold text-primary-ink">
          Automatische Sperre
        </h4>

        {/* Freie Minutenwahl (1-60) + Presets als Schnellklick-Chips (Issue
            #17): ersetzt das feste Dropdown der sieben LOCK_OPTIONS-Werte.
            Nur sichtbar, solange "Nie" nicht aktiv ist -- bei "Nie" gibt es
            keine Minutenzahl zu wählen. */}
        {lockMin !== NEVER_LOCK && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="autolock-minutes"
                className="text-sm text-secondary-ink"
              >
                Nach Inaktivität sperren:
              </label>
              <input
                id="autolock-minutes"
                type="number"
                inputMode="numeric"
                min={MIN_LOCK_INPUT}
                max={MAX_LOCK_INPUT}
                step={1}
                value={draftMinutes}
                onChange={(e) => onMinutesInputChange(e.target.value)}
                onBlur={onMinutesInputBlur}
                className={input + " min-h-touch-pointer w-24"}
              />
              <span className="text-sm text-secondary-ink">Minuten</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {LOCK_OPTIONS.map((m) => (
                <TagChip
                  key={m}
                  label={`${m} Min.`}
                  variant="selectable"
                  active={lockMin === m}
                  onClick={() => void changeLock(m)}
                />
              ))}
            </div>
          </>
        )}

        {/* "Nie automatisch sperren" (Issue #17, Sentinel 0): eigenständige
            Option statt einer achten Dropdown-Zeile, damit der deutliche
            Warnhinweis danach nicht in der Minutenliste untergeht. Bleibt
            IMMER sichtbar (auch wenn aktiv), damit sich die Wahl wieder
            rückgängig machen lässt. */}
        <div className={lockMin !== NEVER_LOCK ? "mt-3" : undefined}>
          <TagChip
            label="Nie automatisch sperren"
            variant="selectable"
            active={lockMin === NEVER_LOCK}
            onClick={toggleNeverLock}
          />
        </div>

        {lockMin === NEVER_LOCK && (
          <p className="mt-2 rounded border border-warning-banner-line bg-warning-banner px-3 py-2 text-sm text-warning-banner-ink">
            Ohne Auto-Sperre bleibt die entsperrte App unbegrenzt offen — auf
            gemeinsam genutzten Rechnern ein Risiko für das BR-Geheimnis.
          </p>
        )}

        <div className="mt-3">
          <button type="button" className={outlineBtn} onClick={onLockNow}>
            Jetzt sperren
          </button>
        </div>

        <p className="mt-3 text-xs text-secondary-ink">
          {lockMin === NEVER_LOCK
            ? "Die App sperrt weiterhin beim Minimieren oder Wechseln des Fensters -- nur die Inaktivitäts-Sperre ist ausgeschaltet."
            : "Nach dieser Zeit ohne Aktivität sowie beim Minimieren des Fensters wird gesperrt."}{" "}
          Beim Sperren wird der Entschlüsselungs-Schlüssel aus dem Speicher
          entfernt – die Datei ist dann wieder vollständig verschlüsselt.
        </p>
      </section>

      {/* Fingerabdruck-Anmeldung (Issue #2, B-UI): nur Android UND nur, wenn
          das Gerät Biometrie überhaupt anbietet -- ohne Verfügbarkeit bleibt
          der Abschnitt ganz weg (kein toter Hinweis). bioLoading verhindert
          ein kurzes Aufblitzen, bevor die Prüfung durch ist. */}
      {mobile && !bioLoading && bioAvail && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-primary-ink">
            Fingerabdruck-Anmeldung
          </h4>
          <p className="mb-2 text-xs text-secondary-ink">
            Entsperrt die App mit deinem Fingerabdruck. Dein Passwort bleibt
            weiterhin gültig und wird für Änderungen an den
            Sicherheitseinstellungen benötigt.
          </p>
          <p className="mb-3 flex items-center gap-2 text-sm text-secondary-ink">
            <Icon name="fingerprint" size={18} />
            Status:{" "}
            <span
              className={
                "font-medium " +
                (bioEnrolled ? "text-success" : "text-secondary-ink")
              }
            >
              {bioEnrolled ? "Aktiviert" : "Nicht aktiviert"}
            </span>
          </p>

          {bioEnrolled ? (
            confirmingBioDisable ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-secondary-ink">
                  Wirklich deaktivieren?
                </span>
                <button
                  type="button"
                  className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-danger-hover disabled:opacity-50"
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
                (bioMsg.ok ? "text-success" : "text-danger-ink")
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
