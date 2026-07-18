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
  bioStatus,
  bioAvailable,
  unlockWithBiometric,
  BioError,
} from "../lib/auth";
import RecoveryCodeReveal from "../components/RecoveryCodeReveal";
import { Icon } from "../components/Icon";

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
  // Vorgezogen (ursprünglich weiter unten, nach den Fehler-/keyfileMissing-
  // Sonderfällen berechnet): der neue Fingerabdruck-Effekt unten braucht
  // isUnlock bereits VOR jedem conditional return -- Hooks müssen in jedem
  // Render unbedingt in derselben Reihenfolge laufen (Rules of Hooks), reine
  // const-Berechnungen dürfen dafür beliebig früh stehen.
  const isUnlock = startMode === "encrypted";
  const isMigrate = startMode === "needsMigration";

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

  // --- Fingerabdruck-Entsperren (Issue #2, B-UI) ---
  const [bioAvail, setBioAvail] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  // Verhindert einen doppelten Auto-Prompt (StrictMode ruft Effekte im
  // Dev-Modus zweimal auf; ein Re-Render darf den bereits gezeigten
  // BiometricPrompt ebenfalls nicht ein zweites Mal auslösen).
  const bioAutoTriggeredRef = useRef(false);

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

  // Entsperrt per Fingerabdruck (BiometricPrompt). Sowohl vom Auto-Prompt-
  // Effekt unten als auch vom sichtbaren "Mit Fingerabdruck entsperren"-Button
  // (manuelle Wiederholung nach Abbruch/Lockout) genutzt.
  const runBioUnlock = async () => {
    setBioError(null);
    setBioBusy(true);
    try {
      await unlockWithBiometric();
      onUnlocked();
    } catch (e) {
      const be = e as BioError;
      switch (be?.kind) {
        case "canceled":
          // Still: Nutzer hat den System-Dialog abgebrochen -- Passwortfeld
          // bleibt einfach stehen, kein Fehlertext.
          break;
        case "lockout":
          setBioError("Zu viele Versuche – bitte warte kurz oder nutze das Passwort.");
          break;
        case "keyInvalidated":
          setBioError(
            "Fingerabdruck-Anmeldung ist ungültig geworden (neuer Fingerabdruck im System registriert?). Bitte mit Passwort entsperren und die Funktion in den Einstellungen neu aktivieren."
          );
          // Rust hat den bio-Wrap bereits entfernt -- bio_status neu laden,
          // damit der Button zuverlässig verschwindet (statt nur lokal zu raten).
          bioStatus()
            .then((s) => setBioEnrolled(s.enrolled))
            .catch(() => setBioEnrolled(false));
          break;
        case "unavailable":
        case "other":
        default:
          setBioError(be?.message || "Fingerabdruck-Entsperren fehlgeschlagen.");
          break;
      }
    } finally {
      setBioBusy(false);
    }
  };

  // Lädt Verfügbarkeit + Aktivierungsstatus und löst danach -- falls aktiv --
  // EINMALIG automatisch den BiometricPrompt aus (Standard-Muster von
  // Banking-Apps). Nur im echten Entsperren-Modus, NICHT bei Erst-
  // Einrichtung/Migration/keyfileMissing (dort gibt es noch keinen bio-Wrap
  // bzw. keine entsperrbare DB).
  //
  // Gerätetest-Fix (Hypothese "Auto-Prompt-Race", B-UI): App.tsx sperrt sofort
  // bei document.hidden (visibilitychange) -- dieser Effekt hier lief bisher
  // GENAU DANN mit, oft also noch während die App im Hintergrund ist bzw. die
  // Android-Activity noch nicht wieder RESUMED ist. Der native BiometricPrompt
  // dort auszulösen ist ein bekanntes Timing-Problem (FragmentTransaction vor
  // onResume). Fix: nur auslösen, wenn document.visibilityState === "visible"
  // ist; ist die Seite gerade verborgen, auf das nächste "visible"-Ereignis
  // warten statt sofort zu feuern. Der native Kotlin-Teil (BiometricUnlock-
  // Plugin.showPrompt) prüft zusätzlich den Activity-Lifecycle-Zustand
  // (RESUMED) als zweite Verteidigungslinie.
  useEffect(() => {
    if (!mobile || !isUnlock) return;
    let active = true;

    const tryAutoTrigger = async () => {
      if (bioAutoTriggeredRef.current || document.visibilityState !== "visible") return;
      try {
        const [status, avail] = await Promise.all([bioStatus(), bioAvailable()]);
        if (!active) return;
        setBioEnrolled(status.enrolled);
        setBioAvail(avail.available);
        if (
          status.enrolled &&
          avail.available &&
          !bioAutoTriggeredRef.current &&
          document.visibilityState === "visible"
        ) {
          bioAutoTriggeredRef.current = true;
          void runBioUnlock();
        }
      } catch {
        // Fingerabdruck-Pfad ist ein Komfort-Zusatz -- ohne verlässliche
        // Antwort bleibt einfach nur die Passwort-Eingabe übrig.
      }
    };

    void tryAutoTrigger();
    const onVisibilityChange = () => void tryAutoTrigger();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, isUnlock]);

  const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
  const locked = remaining > 0;

  const input =
    "w-full rounded border border-border-strong bg-white px-3 py-2 text-sm text-primary-ink outline-none focus:border-sky-500 dark:bg-slate-900";
  const primaryBtn =
    "w-full rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50";

  // Logo dekorativ (alt=""), der Produktname steht als h1 "BR-Log" im
  // jeweiligen Karteninhalt -- Screenreader lesen ihn also weiterhin genau
  // einmal. brand-logo-wrap hält es im Dunkelmodus auf hellem Badge lesbar
  // (dasselbe Muster wie in der Desktop-Sidebar).
  const shell = (children: React.ReactNode) => (
    <div
      className={
        mobile
          ? "flex h-full flex-col items-center justify-center bg-background p-4"
          : "flex h-full items-center justify-center bg-background p-4"
      }
    >
      {mobile && (
        <span className="brand-logo-wrap mb-4">
          <img src={logo} alt="" aria-hidden="true" className="h-10 w-auto" />
        </span>
      )}
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
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
        <h1 className="text-lg font-bold text-primary-ink">BR-Log</h1>
        <p className="font-medium text-danger-ink">
          Start nicht möglich
        </p>
        <p className="break-all text-sm text-secondary-ink">
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
          <h1 className="text-lg font-bold text-primary-ink">BR-Log</h1>
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
            Schlüsseldatei fehlt
          </p>
        </div>
        <p className="break-all text-sm text-secondary-ink">
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
        <p className="text-center text-xs text-secondary-ink">
          Nachdem die Schlüsseldatei zurückgelegt wurde, hier klicken oder die
          App neu starten.
        </p>
      </div>
    );
  }

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
        <h1 className="text-lg font-bold text-primary-ink">BR-Log</h1>
        <p className="mt-1 text-sm text-secondary-ink">{subtitle}</p>
      </div>

      {!isUnlock && (
        <p className="rounded bg-info-surface p-2 text-xs text-sky-800 dark:text-sky-200">
          {isMigrate
            ? "Die vorhandenen Daten werden jetzt mit SQLCipher (AES-256) verschlüsselt. Eine unverschlüsselte Sicherungskopie wird angelegt; sie kann anschließend über das Menü unter Einstellungen → Datenbank gelöscht werden."
            : "Die Datenbank wird mit SQLCipher (AES-256) verschlüsselt. Ohne Passwort bzw. Wiederherstellungs-Code sind die Daten nicht lesbar."}
        </p>
      )}

      {/* Fingerabdruck-Pfad (Issue #2, B-UI): nur im Entsperren-Modus, nur
          Android, nur wenn aktiviert UND das Gerät Biometrie aktuell anbietet.
          Nicht bei Wiederherstellungs-Code -- dort ist Fingerabdruck keine
          sinnvolle Alternative. Der native BiometricPrompt läuft ggf. schon
          automatisch (siehe Effekt oben); der Button hier ist die sichtbare
          manuelle Wiederholung nach Abbruch/Lockout. */}
      {isUnlock && mobile && bioEnrolled && bioAvail && !useRecovery && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void runBioUnlock()}
            disabled={bioBusy}
            aria-label="Mit Fingerabdruck entsperren"
            className="flex min-h-touch w-full items-center justify-center gap-2 rounded border border-sky-600 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-400 dark:text-sky-300 dark:hover:bg-sky-900/20"
          >
            <Icon name="fingerprint" size={20} />
            {bioBusy ? "Wird geprüft…" : "Mit Fingerabdruck entsperren"}
          </button>
          {bioError && (
            <p
              role="status"
              aria-live="polite"
              className="text-center text-sm text-danger-ink"
            >
              {bioError}
            </p>
          )}
        </div>
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
        <p className="text-center text-sm text-danger-ink">{error}</p>
      )}
    </form>
  );
}
