// Gemeinsame Tailwind-Klassenkonstanten für Standard-Formularelemente und
// Sekundär-Buttons (Finding 43). Das Eingabefeld-Styling war zuvor in 7+
// Dateien mit realer Drift getrennt gepflegt (fehlendes dark:placeholder in
// EntryList, abweichendes Padding p-1 statt p-2 in TagManager); der
// Sekundär-Button existierte in zwei Größen 6-fach dupliziert. EIN canonical
// String je Variante hier -- künftige Design-Anpassungen (Akzentfarbe,
// Fokus-Ring) an EINER Stelle statt an ~15.
//
// Bewusst NICHT konsolidiert: der Primär-Button (Akzentfarbe sky-600) trägt
// in der App fünf unterschiedliche, kontextabhängige Größen (px-2 py-1 bis
// px-6 py-2) -- eine Vereinheitlichung würde reale visuelle Unterschiede
// einebnen statt Drift zu beseitigen. Ebenso bewusst ausgenommen: die
// Eingabefelder von LockScreen/SecurityPanel (eigener Login-Look mit
// fokussiertem Rahmen in sky-500 statt Standard-Rahmen) und die
// Aktionskacheln in ExportPanel (eigenständiges großformatiges Layout).

/** Standard-Text-/Textarea-Eingabefeld (Formulare, Filter, Editoren). */
export const inputCls =
  "rounded border border-border-strong bg-surface-input p-2 text-sm text-primary-ink placeholder:text-disabled-ink";

/** Sekundär-Button, große Variante (Modal-/Formular-Aktionsleisten). */
export const secondaryBtnCls =
  "rounded border border-border-strong px-4 py-2 text-sm text-primary-ink hover:bg-surface-2";

/** Sekundär-Button, kompakte Variante (Toolbar-/Inline-Aktionen). */
export const secondaryBtnSmCls =
  "rounded border border-border-strong px-3 py-1.5 text-sm text-primary-ink hover:bg-surface-2";

/** Rote Fehlerbox (Lade-/Aktionsfehler) -- war fünffach inline kopiert. */
export const errorBoxCls =
  "rounded border border-error bg-error-surface px-3 py-2 text-sm text-error-ink";

/** Formular-Feldbeschriftung (EntryForm/AppointmentForm). */
export const labelCls = "mb-1 block text-sm font-medium text-primary-ink";

/** Formular-Abschnittsblock (EntryForm/AppointmentForm). */
export const formBlockCls =
  "space-y-3 rounded-lg border border-border bg-surface p-4";
