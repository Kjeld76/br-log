// Einstellung "Vertrauliches bei Fokusverlust verbergen" (Issue #17, Task 8,
// Desktop-only): reine localStorage-IO (kein Geheimnis, analog
// secureScreen.ts/lockDelay.ts) -- bewusst UNGETESTET (wie dort). Die
// eigentliche Wirkung (Blur-Klasse `confidential-blur` + Attribut
// `data-window-blurred`) sitzt in styles.css/App.tsx; diese Datei liefert
// nur Default + Persistenz für den Schalter in SecurityPanel.

const STORAGE_KEY = "brlog.blurOnFocusLoss";

/** Default AN (Auftrag): der Sichtschutz ist die sichere Voreinstellung. */
export function getBlurOnFocusLossEnabled(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === "1";
}

export function setBlurOnFocusLossEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}
