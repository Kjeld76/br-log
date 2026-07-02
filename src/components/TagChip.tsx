// Konsolidierte Tag-Chip-Darstellung (Finding 47): der klickbare Auswahl-Chip
// war zweimal fast identisch implementiert (TagFilterChips, EntryForm-Picker)
// mit Drift (hover-Ton, fehlende transition-Klasse); der Read-only-Chip
// existierte zweifach mit abweichender Größe/Farbe (EntryDetail, EntryList).
// EIN Chip mit drei Varianten (selektierbar/entfernbar/read-only) ersetzt
// alle vier Stellen.

interface Props {
  label: string;
  variant: "selectable" | "removable" | "readonly";
  active?: boolean; // nur "selectable": aktueller Auswahlzustand
  archived?: boolean; // nur "removable": archiviertes Schlagwort
  disabled?: boolean; // nur "removable": Entfernen-Button gesperrt
  onClick?: () => void; // "selectable" (Toggle) und "removable" (Entfernen)
}

export default function TagChip({
  label,
  variant,
  active,
  archived,
  disabled,
  onClick,
}: Props) {
  if (variant === "readonly") {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
        {label}
      </span>
    );
  }

  if (variant === "removable") {
    return (
      <span
        className={
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-white " +
          (archived ? "bg-slate-400 dark:bg-slate-600" : "bg-sky-600")
        }
      >
        {label}
        {archived && <span className="opacity-80">(archiviert)</span>}
        <button
          type="button"
          className="text-white/80 hover:text-white"
          onClick={onClick}
          aria-label="Entfernen"
          disabled={disabled}
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-xs transition " +
        (active
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")
      }
    >
      {label}
    </button>
  );
}
