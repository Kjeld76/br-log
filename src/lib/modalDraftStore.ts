// Modul-lokaler In-Memory-Store für den Formular-Entwurf des GERADE offenen
// Bearbeiten-Modals (Eintrag/Termin) beim Sperren der App (Issue #17,
// Task 9).
//
// Hintergrund: Die Sperre unmountet den GESAMTEN Komponentenbaum (Aufblitz-
// Schutz, s. App.tsx `if (locked) return <LockScreen .../>`) -- ein offenes
// Bearbeiten-Formular (EntryForm/AppointmentForm) verliert dabei sein
// EIGENES, internes React-State (den ungespeicherten Entwurf), auch wenn
// App.tsx den `modal`-State selbst nicht zurücksetzt. QuickEntryView löst
// dasselbe Problem für die Startseite über einen eigenen Draft-Store
// (`views/quickEntryDraft.ts`, `brlog.quickEntryDraft`) -- der hält
// `secretDetails` inzwischen nach demselben Muster wie HIER NUR im RAM
// (Issue #35: ein reiner localStorage-Draft hatte das Geheimnis vorher im
// Klartext auf die Platte geschrieben), unkritische Felder aber weiter auf
// Platte. Dieser Store hier bleibt bewusst noch enger: für DIESE Formulare
// (Bearbeiten-Modal) landet gar nichts auf der Platte, auch keine
// unkritischen Felder -- Klartext-Geheimnis auf Platte wäre ein
// Vertraulichkeits-Leck, selbst innerhalb des lokalen WebView-Profils.
//
// Abwägung: eine reine Modul-Variable überlebt Sperren + Entsperren (der
// Prozess läuft unverändert weiter, nur der Komponentenbaum wird neu
// gemountet), aber bewusst NICHT einen App-Neustart (Prozessende räumt den
// Speicher, RAM ist danach weg) -- genau das erfüllt den Issue-Auftrag
// ("Formular-Drafts überleben die Sperre"), ohne das Disk-Risiko einzugehen,
// das eine echte Persistenz hätte. NIEMALS localStorage/eine Datei
// verwenden -- das würde die Abwägung genau umkehren.
//
// take*-Semantik: GENAU EIN erfolgreicher Abruf pro Sicherung. App.tsx
// sichert beim `doLock()` und öffnet das Modal nach erfolgreichem Entsperren
// GENAU EINMAL mit dem Draft wieder -- ein zweiter Abruf (kein neuer Draft
// zwischenzeitlich gesichert) liefert deshalb null statt eines veralteten
// Rests aus einem früheren Sperr-/Entsperr-Zyklus.

let currentDraft: unknown = null;

/** Legt einen Draft ab -- überschreibt einen evtl. noch nicht abgeholten. */
export function saveModalDraft(draft: unknown): void {
  currentDraft = draft;
}

/**
 * Gibt den gesicherten Draft GENAU EINMAL zurück und entfernt ihn danach aus
 * dem Store -- ein zweiter Aufruf ohne zwischenzeitliches `saveModalDraft`
 * liefert `null`.
 */
export function takeModalDraft(): unknown | null {
  const draft = currentDraft;
  currentDraft = null;
  return draft ?? null;
}

/** Verwirft einen gesicherten Draft explizit, ohne ihn zurückzugeben. */
export function clearModalDraft(): void {
  currentDraft = null;
}
