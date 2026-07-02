// Generisches Segmented-Control (Finding 48): HistoryView (Liste/Kalender)
// und ThemeToggle (Hell/Dunkel/System) implementierten dasselbe UI-Muster
// getrennt, mit Detail-Drift (hover-Ton, Padding, fehlende transition-Klasse
// in HistoryView). EINE generische Komponente ersetzt beide.

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "rounded px-3 py-1.5 text-sm transition " +
              (active
                ? "bg-sky-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
