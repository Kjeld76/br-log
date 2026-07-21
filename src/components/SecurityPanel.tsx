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
import { acceleratorFromEvent, formatAccelerator } from "../lib/hotkey";
import {
  getLockHotkeySettings,
  setLockHotkeySettings,
  type LockHotkeySettings,
} from "../lib/lockHotkey";
import {
  getAndroidLockDelaySec,
  setAndroidLockDelaySec,
  ANDROID_LOCK_DELAY_OPTIONS_SEC,
  type AndroidLockDelaySec,
} from "../lib/lockDelay";
import { getSecureScreenEnabled, setSecureScreenEnabled } from "../lib/secureScreen";
import {
  getBlurOnFocusLossEnabled,
  setBlurOnFocusLossEnabled,
} from "../lib/blurOnFocusLoss";
import RecoveryCodeReveal from "./RecoveryCodeReveal";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  onLockNow: () => void;
  onAutoLockChanged: (minutes: number) => void;
  // Issue #17, Task 7: meldet die Android-Karenz-Einstellung an App.tsx
  // zurück (analog onAutoLockChanged/autoLockMin) -- die Verdrahtung des
  // visibilitychange-Handlers braucht den jeweils aktuellen Wert.
  onAndroidLockDelayChanged: (sec: AndroidLockDelaySec) => void;
  // Issue #17, Task 8: meldet die Sichtschutz-Blur-Einstellung an App.tsx
  // zurück (analog onAndroidLockDelayChanged/androidLockDelaySec) -- der
  // window blur/focus-Effekt dort braucht den jeweils aktuellen Wert.
  onBlurOnFocusLossChanged: (enabled: boolean) => void;
  // Konvention (siehe App.tsx): isAndroid() wird zentral EINMAL in App.tsx
  // ermittelt und als Prop durchgereicht -- hier nur gebraucht, um den
  // Fingerabdruck-Abschnitt auf Android zu gaten (Desktop hat keinen
  // BiometricPrompt, bio_available liefert dort ohnehin available:false,
  // aber der Aufruf selbst spart sich die App auf Desktop komplett).
  mobile: boolean;
}

// Optionen für "Sperren beim Verlassen der App" (Issue #17, Task 7,
// Android-only): Sofort (Sentinel 0, siehe lockDelay.ts) | 30 s | 1 min |
// 5 min. Reihenfolge/Labels laut Auftrag.
const LOCK_DELAY_LABELS: Record<AndroidLockDelaySec, string> = {
  0: "Sofort (empfohlen)",
  30: "30 s",
  60: "1 min",
  300: "5 min",
};

// Schnellklick-Chips für die Auto-Sperre-Minuten (Issue #17): waren bis
// v1.8.0 die einzige Auswahl (Dropdown mit genau diesen sieben Werten),
// bleiben jetzt als Presets neben dem freien 1-60-Eingabefeld erhalten --
// alle sieben Werte liegen ohnehin innerhalb der neuen 1-60-Grenze.
const LOCK_OPTIONS = [1, 3, 5, 10, 15, 30, 60];
const MIN_LOCK_INPUT = 1;
const MAX_LOCK_INPUT = 60;

// Ein Tastendruck aus mehreren Tasten (z. B. Strg+Umschalt+L) löst NACHEINANDER
// mehrere keydown-Events aus (erst Strg, dann Umschalt, erst danach die
// Haupttaste). Modifier-Tasten allein werden beim Aufnehmen still ignoriert
// (weiter warten) statt bei jedem Zwischenschritt den Fehlerhinweis
// aufblitzen zu lassen -- der Hinweis erscheint erst bei einer TATSÄCHLICH
// ungültigen Kombination (z. B. Taste ganz ohne Ctrl/Alt/Meta).
const MODIFIER_ONLY_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
// Sentinel „nie automatisch sperren" (siehe lib/auth.ts NEVER_AUTOLOCK_MIN) --
// identischer Wert, hier lokal benannt, damit diese Datei nicht den
// modulinternen Namen aus auth.ts importieren muss (der ist bewusst nicht
// exportiert, s. dortiger Kommentar).
const NEVER_LOCK = 0;
const DEFAULT_LOCK_MIN = 5;

export default function SecurityPanel({
  onLockNow,
  onAutoLockChanged,
  onAndroidLockDelayChanged,
  onBlurOnFocusLossChanged,
  mobile,
}: Props) {
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

  // Globaler Sofortsperre-Hotkey (Issue #17, Desktop-only): Einstellung liegt
  // in localStorage (lockHotkey.ts, kein Geheimnis) -- lazy-Init liest sie
  // synchron beim ersten Render, ohne einen zusätzlichen Lade-Zustand zu
  // brauchen (anders als z. B. bioAvailable, das echt asynchron ist).
  const [hotkeyEnabled, setHotkeyEnabledState] = useState(
    () => getLockHotkeySettings().enabled
  );
  const [hotkeyAccel, setHotkeyAccelState] = useState(
    () => getLockHotkeySettings().accelerator
  );
  const [hotkeyRecording, setHotkeyRecording] = useState(false);
  const [hotkeyBusy, setHotkeyBusy] = useState(false);
  const [hotkeyMsg, setHotkeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Android-Karenz "Sperren beim Verlassen der App" (Issue #17, Task 7):
  // localStorage-Persistenz (lockDelay.ts), lazy-Init wie beim Hotkey oben.
  const [lockDelaySec, setLockDelaySecState] = useState<AndroidLockDelaySec>(
    () => getAndroidLockDelaySec()
  );

  // Screenshot-/Vorschau-Schutz (Issue #17, Task 7): Default AN (s.
  // MainActivity.onCreate); lazy-Init aus localStorage wie oben.
  const [secureScreenEnabled, setSecureScreenEnabledState] = useState(
    () => getSecureScreenEnabled()
  );
  const [secureScreenBusy, setSecureScreenBusy] = useState(false);
  const [secureScreenMsg, setSecureScreenMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Sichtschutz-Blur bei Fensterfokus-Verlust (Issue #17, Task 8,
  // Desktop-only): Default AN, lazy-Init aus localStorage wie oben. Reine
  // Persistenz + Meldung an App.tsx -- kein Backend-Roundtrip nötig (anders
  // als secureScreenEnabled, das über einen Rust-Command läuft).
  const [blurOnFocusLossEnabled, setBlurOnFocusLossEnabledState] = useState(() =>
    getBlurOnFocusLossEnabled()
  );

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

  // Persistiert + registriert den Hotkey neu (lockHotkey.ts); bei einem
  // Registrierungsfehler (Kombination anderweitig belegt) bleibt die
  // vorherige, funktionierende Einstellung aktiv (Rollback in lockHotkey.ts)
  // -- hier nur die UI-Zustände entsprechend nachführen bzw. die Meldung zeigen.
  const applyHotkeyChange = async (next: LockHotkeySettings) => {
    setHotkeyBusy(true);
    setHotkeyMsg(null);
    try {
      await setLockHotkeySettings(next);
      setHotkeyEnabledState(next.enabled);
      setHotkeyAccelState(next.accelerator);
    } catch (err) {
      setHotkeyMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setHotkeyBusy(false);
    }
  };

  const toggleHotkeyEnabled = () => {
    void applyHotkeyChange({ enabled: !hotkeyEnabled, accelerator: hotkeyAccel });
  };

  // Android-Karenz (Issue #17, Task 7): reine localStorage-Persistenz, kein
  // Backend-Roundtrip nötig -- App.tsx übernimmt den neuen Wert über
  // onAndroidLockDelayChanged (baut den visibilitychange-Handler neu auf).
  const changeLockDelay = (sec: AndroidLockDelaySec) => {
    setLockDelaySecState(sec);
    setAndroidLockDelaySec(sec);
    onAndroidLockDelayChanged(sec);
  };

  // Screenshot-/Vorschau-Schutz (Issue #17, Task 7): optimistisch umschalten,
  // bei einem Fehlschlag des Commands (z. B. Plugin-Fehler) zurückrollen --
  // der Default aus MainActivity.onCreate bleibt in jedem Fall unberührt.
  const toggleSecureScreen = () => {
    const next = !secureScreenEnabled;
    setSecureScreenEnabledState(next);
    setSecureScreenBusy(true);
    setSecureScreenMsg(null);
    void setSecureScreenEnabled(next)
      .catch((err) => {
        setSecureScreenEnabledState(!next);
        setSecureScreenMsg({
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setSecureScreenBusy(false));
  };

  // Sichtschutz-Blur (Issue #17, Task 8): reine localStorage-Persistenz,
  // App.tsx übernimmt den neuen Wert über onBlurOnFocusLossChanged (baut den
  // window blur/focus-Effekt neu auf, analog changeLockDelay).
  const toggleBlurOnFocusLoss = () => {
    const next = !blurOnFocusLossEnabled;
    setBlurOnFocusLossEnabledState(next);
    setBlurOnFocusLossEnabled(next);
    onBlurOnFocusLossChanged(next);
  };

  // Aufnahme-Feld: der Button selbst fängt den nächsten Tastendruck ab.
  // Escape bricht ohne Änderung ab; eine ungültige Kombination (kein
  // Ctrl/Alt/Meta + Taste, s. hotkey.ts) zeigt einen Hinweis, OHNE den
  // Aufnahme-Modus zu verlassen -- der nächste Versuch ist sofort möglich.
  const onHotkeyRecordKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (e.key === "Escape") {
      setHotkeyRecording(false);
      return;
    }
    if (MODIFIER_ONLY_KEYS.has(e.key)) return;
    const acc = acceleratorFromEvent(e.nativeEvent);
    if (!acc) {
      setHotkeyMsg({
        ok: false,
        text: "Bitte Strg, Alt oder die Windows-/Befehlstaste zusammen mit einer weiteren Taste drücken.",
      });
      return;
    }
    setHotkeyRecording(false);
    void applyHotkeyChange({ enabled: hotkeyEnabled, accelerator: acc });
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

      {/* Globaler Sofortsperre-Hotkey (Issue #17, Desktop-only): Registrierung
          über tauri-plugin-global-shortcut läuft frontendseitig (lockHotkey.ts,
          App.tsx). Auf Android gibt es weder ein Konzept für systemweite
          Hotkeys noch das Plugin -- der Abschnitt bleibt dort komplett weg
          (kein toter, nie wirksamer Schalter). */}
      {!mobile && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-primary-ink">
            Globaler Hotkey
          </h4>
          <p className="mb-3 text-xs text-secondary-ink">
            Sperrt BR-Log sofort per Tastenkombination -- auch wenn das
            Fenster gerade nicht im Fokus ist. Wirkt nur, solange die App
            entsperrt ist.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <TagChip
              label={hotkeyEnabled ? "Aktiviert" : "Deaktiviert"}
              variant="selectable"
              active={hotkeyEnabled}
              onClick={toggleHotkeyEnabled}
            />
            <button
              type="button"
              className={outlineBtn}
              disabled={hotkeyBusy}
              title="Klicken und neue Tastenkombination drücken"
              onClick={() => {
                setHotkeyMsg(null);
                setHotkeyRecording(true);
              }}
              onKeyDown={hotkeyRecording ? onHotkeyRecordKeyDown : undefined}
              onBlur={() => setHotkeyRecording(false)}
            >
              {hotkeyRecording
                ? "Kombination drücken… (Esc bricht ab)"
                : `Kombination: ${formatAccelerator(hotkeyAccel)}`}
            </button>
          </div>
          {hotkeyMsg && (
            <p
              role="status"
              aria-live="polite"
              className={
                "mt-2 text-sm " + (hotkeyMsg.ok ? "text-success" : "text-danger-ink")
              }
            >
              {hotkeyMsg.text}
            </p>
          )}
        </section>
      )}

      {/* Sichtschutz-Blur bei Fensterfokus-Verlust (Issue #17, Task 8,
          Desktop-only): blurrt vertrauliche Anzeige-/Eingabeflächen (Klasse
          `confidential-blur`, s. styles.css), solange das BR-Log-Fenster
          nicht im Fokus ist -- reiner Sichtschutz gegen kurzes Wegklicken/
          über die Schulter schauen, KEIN Ersatz für die Sperre (die bleibt
          unverändert, s. App.tsx). Auf Android gibt es dieses
          Fenster-Fokus-Konzept nicht (Wechsel in eine andere App deckt
          bereits die visibilitychange-Sperre ab) -- der Abschnitt bleibt dort
          komplett weg, wie beim Hotkey oben. */}
      {!mobile && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-primary-ink">
            Sichtschutz bei Fensterfokus-Verlust
          </h4>
          <p className="mb-3 text-xs text-secondary-ink">
            Blendet vertrauliche Inhalte (genaue Tätigkeitsbeschreibung,
            vertrauliche Notizen, maskierte Suchtreffer) unscharf, solange das
            Fenster nicht im Fokus ist -- Schutz gegen Mitlesen beim kurzen
            Wegklicken.
          </p>
          <TagChip
            label={blurOnFocusLossEnabled ? "Aktiviert" : "Deaktiviert"}
            variant="selectable"
            active={blurOnFocusLossEnabled}
            onClick={toggleBlurOnFocusLoss}
          />
        </section>
      )}

      {/* Sperren beim Verlassen der App (Issue #17, Task 7, Android-only):
          die opt-in-Karenzzeit vorm Sperren beim Verstecken (lockDelay.ts).
          Auf Desktop bleibt das Sperren unverändert sofort (kein Abschnitt,
          kein toter Schalter, s. App.tsx-Kommentar). */}
      {mobile && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-primary-ink">
            Sperren beim Verlassen der App
          </h4>
          <p className="mb-3 text-xs text-secondary-ink">
            Legt fest, wie lange BR-Log nach dem Wechsel in eine andere App
            oder dem Minimieren wartet, bevor gesperrt wird.
          </p>
          <div className="flex flex-wrap gap-2">
            {ANDROID_LOCK_DELAY_OPTIONS_SEC.map((sec) => (
              <TagChip
                key={sec}
                label={LOCK_DELAY_LABELS[sec]}
                variant="selectable"
                active={lockDelaySec === sec}
                onClick={() => changeLockDelay(sec)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Screenshot-/Vorschau-Schutz (Issue #17, Task 7, Android-only):
          FLAG_SECURE ist per Default AN (MainActivity.onCreate, gilt schon
          vor dem Entsperren) -- dieser Schalter erlaubt nur das gezielte
          Abschalten NACH dem Entsperren (secureScreen.ts -> Command
          set_secure_screen). */}
      {mobile && (
        <section className={card}>
          <h4 className="mb-2 text-sm font-semibold text-primary-ink">
            Screenshot-/Vorschau-Schutz (Android)
          </h4>
          <p className="mb-3 text-xs text-secondary-ink">
            Verhindert Screenshots/Bildschirmaufnahmen und blendet den
            App-Inhalt in der Übersicht zuletzt genutzter Apps aus.
          </p>
          <TagChip
            label={secureScreenEnabled ? "Aktiviert" : "Deaktiviert"}
            variant="selectable"
            active={secureScreenEnabled}
            onClick={toggleSecureScreen}
          />
          {secureScreenBusy && (
            <p className="mt-2 text-xs text-secondary-ink">Wird angewendet…</p>
          )}
          {!secureScreenEnabled && (
            <p className="mt-2 rounded border border-warning-banner-line bg-warning-banner px-3 py-2 text-sm text-warning-banner-ink">
              Aus: App-Inhalt erscheint in der Übersicht zuletzt genutzter Apps
              und auf Screenshots.
            </p>
          )}
          {secureScreenMsg && (
            <p
              role="status"
              aria-live="polite"
              className={
                "mt-2 text-sm " +
                (secureScreenMsg.ok ? "text-success" : "text-danger-ink")
              }
            >
              {secureScreenMsg.text}
            </p>
          )}
        </section>
      )}

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
