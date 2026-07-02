// Übersetzt technische Fehler (SQLite/rusqlite, Tauri-IPC, JS) in eine
// verständliche deutsche Meldung mit Handlungsempfehlung (Finding 21: rohe
// String(e)-Fehlertexte in der UI). Der technische Originaltext bleibt als
// Detail angehängt -- für den seltenen Support-Fall, aber NICHT mehr als
// einziger, unübersetzter Text.

/**
 * Markierung für bereits deutsche, für Endnutzer geschriebene Fehlermeldungen
 * (z. B. Validierungsfehler wie "Ungültige Backup-Datei: ..." oder "Bitte ein
 * Schlagwort eingeben."). toUserMessage gibt deren Text unverändert durch,
 * statt sie wie einen unbekannten technischen Fehler generisch mit "Es ist
 * ein unerwarteter Fehler aufgetreten. (Technisches Detail: …)" zu wrappen --
 * das passierte bisher z. B. beim Backup-Import (parseBackup wirft AppError,
 * ExportPanel zeigt das Ergebnis von toUserMessage an).
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

interface Mapping {
  test: (lower: string) => boolean;
  message: string;
}

const MAPPINGS: Mapping[] = [
  {
    test: (l) => l.includes("database is locked") || l.includes("db gesperrt"),
    message:
      "Die Datenbank ist gerade gesperrt (z. B. durch einen Virenscanner oder eine zweite geöffnete Instanz). Bitte kurz warten und erneut versuchen.",
  },
  {
    test: (l) => l.includes("disk") && (l.includes("full") || l.includes("space")),
    message:
      "Nicht genug freier Speicherplatz auf der Festplatte. Bitte Speicherplatz freigeben und erneut versuchen.",
  },
  {
    test: (l) =>
      l.includes("no such column") ||
      l.includes("no such table") ||
      l.includes("neueren app-version erstellt"),
    message:
      "Die Datenbankstruktur passt nicht zur App-Version. Bitte die App aktualisieren; bleibt der Fehler bestehen, Kontakt zur IT.",
  },
  {
    test: (l) =>
      l.includes("nicht entschlüsselbar") ||
      l.includes("file is not a database") ||
      l.includes("file is encrypted") ||
      l.includes("hmac"),
    message:
      "Die Datenbank lässt sich nicht entschlüsseln (falscher Schlüssel oder beschädigte Datei).",
  },
  {
    test: (l) =>
      l.includes("permission denied") ||
      l.includes("access is denied") ||
      l.includes("zugriff verweigert") ||
      l.includes("os error 5"),
    message:
      "Zugriff verweigert. Bitte prüfen, ob Datei/Ordner beschreibbar sind (z. B. nicht schreibgeschützter USB-Stick).",
  },
  {
    test: (l) => l.includes("no such file or directory") || l.includes("os error 2"),
    message:
      "Datei oder Ordner wurde nicht gefunden (evtl. verschoben oder ein Wechseldatenträger nicht eingesteckt).",
  },
];

/**
 * Liefert eine deutsche, nutzerverständliche Fehlermeldung inkl. Handlungs-
 * empfehlung, mit dem technischen Originaltext als Detail angehängt. Kennt der
 * Text keines der bekannten Muster, gibt es eine generische deutsche Meldung
 * (statt des rohen technischen Strings) mit demselben Detail-Anhang.
 */
export function toUserMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  const hit = MAPPINGS.find((m) => m.test(lower));
  const friendly = hit ? hit.message : "Es ist ein unerwarteter Fehler aufgetreten.";
  return `${friendly} (Technisches Detail: ${raw})`;
}
