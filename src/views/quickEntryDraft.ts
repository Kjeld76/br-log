import type { TimeEntry } from "../types";

// Zwischenstand des Erfassen-Formulars, damit ein App-Neustart (z. B. nach
// versehentlichem Schließen) nichts verliert -- UND damit der Entwurf ein
// Sperren/Entsperren sowie einen Tab-Wechsel übersteht (App.tsx unmountet den
// GESAMTEN Baum beim Sperren, s. dort `if (locked) return <LockScreen .../>`,
// und QuickEntryView selbst bei jedem Verlassen des "Erfassen"-Tabs, s.
// `view === "erfassen" &&` um <QuickEntryView>).
//
// Issue #35 (Sicherheit): Vor diesem Fix landete das komplette TimeEntry --
// INKLUSIVE secretDetails, dem BR-Geheimnis -- im Klartext hier im
// localStorage. localStorage liegt unverschlüsselt im WebView-Profil dieses
// Windows-Benutzers, außerhalb der SQLCipher-Datenbank -- ein direkter
// Widerspruch zum Kernversprechen der App (Geheimnis verschlüsselt at rest).
//
// Lösung (Hybrid, analog dem Modal-Draft-Store aus Issue #17/Task 9, s.
// lib/modalDraftStore.ts): Die unkritischen Felder wandern weiterhin nach
// localStorage -- reiner Komfort, unkritisch, überlebt auch einen
// App-Neustart. secretDetails NUR in `ramSecret`, einer Modul-Variable: die
// überlebt Sperren/Entsperren und Tab-Wechsel (der Prozess läuft dabei
// unverändert weiter), aber bewusst NICHT einen echten App-Neustart (Prozess-
// ende räumt den Speicher) -- dann ist das Vertraulich-Feld eben leer statt
// eines Klartext-Fundes auf der Platte. NIEMALS ein nicht-leeres
// secretDetails nach localStorage/einer Datei schreiben.
//
// `ramSecret` ist bewusst an die Draft-`id` gekoppelt (nicht einfach ein
// nackter String): ohne den Abgleich könnte das Geheimnis eines Entwurfs über
// einen ANDEREN, inzwischen auf der Platte liegenden Entwurf gelegt werden
// (z. B. nach einem Speichern-und-neu-Anfangen-Zyklus mit neuer id).
const DRAFT_KEY = "brlog.quickEntryDraft";

let ramSecret: { id: string; secret: string } | null = null;

function readRaw(): TimeEntry | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimeEntry;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.date !== "string")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(e: TimeEntry): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(e));
  } catch {
    // nicht kritisch -- Persistenz ist nur eine Komfortfunktion
  }
}

export function loadDraft(): TimeEntry | null {
  const persisted = readRaw();
  if (!persisted) return null;

  // Scrub-Migration: Vor diesem Fix (Issue #35) landete secretDetails im
  // Klartext auf der Platte. Ein so entstandener Alt-Draft mit nicht-leerem
  // secretDetails wird EINMALIG ins RAM übernommen UND die Platte sofort ohne
  // das Geheimnis neu geschrieben -- ab dem nächsten Aufruf ist
  // persisted.secretDetails bereits leer, dieser Zweig greift dann nicht mehr.
  if (persisted.secretDetails) {
    ramSecret = { id: persisted.id, secret: persisted.secretDetails };
    writeRaw({ ...persisted, secretDetails: "" });
  }

  const secret = ramSecret?.id === persisted.id ? ramSecret.secret : "";
  return { ...persisted, secretDetails: secret };
}

export function saveDraft(e: TimeEntry): void {
  // RAM zuerst aktualisieren, DANN die (geheimnisfreie) Kopie auf die Platte
  // -- das echte secretDetails verlässt den Prozess nie.
  ramSecret = { id: e.id, secret: e.secretDetails };
  writeRaw({ ...e, secretDetails: "" });
}

/** Löscht den Zwischenstand explizit (z. B. nach Speichern oder bewusstem Verwerfen). */
export function clearQuickEntryDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
  ramSecret = null;
}
