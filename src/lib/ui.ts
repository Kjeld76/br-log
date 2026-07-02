// Gemeinsame Tailwind-Klassenkonstanten für Standard-Formularelemente und
// Sekundär-Buttons (Finding 43). Das Eingabefeld-Styling war zuvor in 7+
// Dateien mit realer Drift getrennt gepflegt (fehlendes dark:placeholder in
// EntryList, abweichendes Padding p-1 statt p-2 in TagManager); der
// Sekundär-Button existierte in zwei Größen 6-fach dupliziert. EIN canonical
// String je Variante hier -- künftige Design-Anpassungen (Akzentfarbe,
// Fokus-Ring) an EINER Stelle statt an ~15.
//
// Bewusst NICHT konsolidiert: der Primär-Button (bg-sky-600) trägt in der
// App fünf unterschiedliche, kontextabhängige Größen (px-2 py-1 bis px-6
// py-2) -- eine Vereinheitlichung würde reale visuelle Unterschiede
// einebnen statt Drift zu beseitigen. Ebenso bewusst ausgenommen: die
// Eingabefelder von LockScreen/SecurityPanel (eigener Login-Look mit
// focus:border-sky-500 statt Standard-Rahmen) und die Aktionskacheln in
// ExportPanel (eigenständiges großformatiges Layout).

/** Standard-Text-/Textarea-Eingabefeld (Formulare, Filter, Editoren). */
export const inputCls =
  "rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500";

/** Sekundär-Button, große Variante (Modal-/Formular-Aktionsleisten). */
export const secondaryBtnCls =
  "rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

/** Sekundär-Button, kompakte Variante (Toolbar-/Inline-Aktionen). */
export const secondaryBtnSmCls =
  "rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";
