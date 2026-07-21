// Hintergrund-Karenzzeit vorm Sperren beim Verlassen der App -- NUR Android
// (Issue #17, Task 7, Nutzer-Entscheid 2026-07-19). Auf dem Desktop bleibt es
// beim Bestandsverhalten (sofortiges Sperren bei document.hidden, siehe
// App.tsx-Kommentar "Bewusst OHNE Gnadenfrist"); diese Datei kommt dort gar
// nicht zum Einsatz.
//
// createLockDelay ist reine, zeit-injizierbare Zustandslogik (Muster
// reminderOrchestrator.ts: IO wird über injizierte Ports/Callbacks
// hereingereicht statt direkt window.setTimeout/clearTimeout aufzurufen) --
// macht die Karenz ohne echten Timer bzw. eine window/document-Umgebung
// testbar (das Projekt bleibt bei Vitest-environment "node", s.
// vitest.config.ts).

export interface LockDelayDeps {
  /** Karenzzeit in Sekunden. <= 0: sofort sperren (Bestandsverhalten). */
  delaySec: number;
  /** Wird beim Sperren aufgerufen (Karenz abgelaufen ODER delaySec <= 0). */
  onLock: () => void;
  /**
   * Startet einen Timer, der nach `ms` Millisekunden `cb` aufruft; liefert
   * eine ID zum Abbrechen. Default: window.setTimeout.
   */
  setTimer?: (cb: () => void, ms: number) => number;
  /** Bricht einen mit setTimer gestarteten Timer ab. Default: window.clearTimeout. */
  clearTimer?: (id: number) => void;
  /**
   * Liefert die aktuelle Zeit in ms (analog reminderOrchestrator.ts). Default:
   * Date.now. Nötig, weil Android WebView-Timer im Hintergrund/bei
   * Bildschirm-Aus gedrosselt/pausiert werden können -- `setTimer` allein
   * reicht dann nicht: der Timer feuert evtl. nie, obwohl die Karenz laut
   * Wanduhr längst abgelaufen ist (s. onVisible).
   */
  now?: () => number;
}

export interface LockDelayController {
  /** App wurde versteckt (document.hidden === true). Startet ggf. die Karenz (neu). */
  onHidden(): void;
  /** App wurde wieder sichtbar. Bricht eine laufende Karenz ab, OHNE zu sperren. */
  onVisible(): void;
  /** Bricht eine laufende Karenz ab (Effekt-Cleanup/Unmount) -- reiner Alias für onVisible. */
  dispose(): void;
}

/**
 * Baut den Karenz-Controller. `delaySec <= 0`: `onHidden()` sperrt sofort
 * (kein Timer, entspricht dem Bestandsverhalten). `delaySec > 0`:
 * `onHidden()` merkt sich den Zeitpunkt (`now()`) UND startet einen Timer.
 * Wird die App vor Ablauf wieder sichtbar (`onVisible()`), prüft diese
 * zusätzlich die seit `onHidden()` vergangene Zeit gegen `delaySec`: liegt
 * sie DARUNTER, war die Rückkehr rechtzeitig -- der Timer wird abgebrochen,
 * OHNE zu sperren. Liegt sie DARÜBER ODER GLEICH (der Timer hätte also
 * längst feuern müssen, ist aber z. B. wegen Android-Hintergrund-Drosselung
 * nie gefeuert), wird sofort gesperrt -- die Karenz gilt dann als
 * abgelaufen, auch ohne dass `setTimer`s Callback je lief. Läuft der Timer
 * regulär ab (App bleibt durchgehend versteckt), feuert `onLock()` wie
 * gehabt. Ein zweites `onHidden()` (z. B. erneutes Verstecken nach einem
 * abgebrochenen Timer, oder ohne zwischenzeitliche Rückkehr) bricht einen
 * evtl. noch laufenden Timer ab und startet die Karenz komplett neu.
 */
export function createLockDelay(deps: LockDelayDeps): LockDelayController {
  const setTimer = deps.setTimer ?? ((cb, ms) => window.setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((id) => window.clearTimeout(id));
  const now = deps.now ?? Date.now;
  let timerId: number | undefined;
  let hiddenAt: number | undefined;

  const cancel = () => {
    if (timerId !== undefined) {
      clearTimer(timerId);
      timerId = undefined;
    }
    hiddenAt = undefined;
  };

  return {
    onHidden() {
      cancel(); // zweites Verstecken startet die Karenz neu, kein doppelter Timer
      if (deps.delaySec <= 0) {
        deps.onLock();
        return;
      }
      hiddenAt = now();
      timerId = setTimer(() => {
        timerId = undefined;
        hiddenAt = undefined;
        deps.onLock();
      }, deps.delaySec * 1000);
    },
    onVisible() {
      // Suspend-Fall (Android-WebView-Timer im Hintergrund pausiert/
      // gedrosselt): der Timer ist noch als anhängig verzeichnet, aber laut
      // Wanduhr ist die Karenz bereits um -- dann NICHT nur abbrechen,
      // sondern sofort sperren (der Timer hätte längst feuern müssen).
      if (timerId !== undefined && hiddenAt !== undefined) {
        const elapsedMs = now() - hiddenAt;
        if (elapsedMs >= deps.delaySec * 1000) {
          cancel();
          deps.onLock();
          return;
        }
      }
      cancel();
    },
    dispose: cancel,
  };
}

// ---------- Einstellung „Sperren beim Verlassen der App" (Persistenz) ----------
//
// Reine localStorage-IO (kein Geheimnis, analog lockHotkey.ts) -- bewusst
// UNGETESTET (wie dort): die testbare Logik ist ausschließlich createLockDelay
// oben.

const STORAGE_KEY = "brlog.androidLockDelaySec";

/** Erlaubte Werte (Auftrag): Sofort (0) | 30 s | 1 min | 5 min. */
export const ANDROID_LOCK_DELAY_OPTIONS_SEC = [0, 30, 60, 300] as const;
export type AndroidLockDelaySec = (typeof ANDROID_LOCK_DELAY_OPTIONS_SEC)[number];

function isAllowedDelay(n: number): n is AndroidLockDelaySec {
  return (ANDROID_LOCK_DELAY_OPTIONS_SEC as readonly number[]).includes(n);
}

/** Default 0 ("Sofort"), auch bei fehlendem/ungültigem Bestand. */
export function getAndroidLockDelaySec(): AndroidLockDelaySec {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return isAllowedDelay(raw) ? raw : 0;
}

export function setAndroidLockDelaySec(sec: AndroidLockDelaySec): void {
  localStorage.setItem(STORAGE_KEY, String(sec));
}
