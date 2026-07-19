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
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
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
                ? "bg-primary text-on-primary"
                : "text-secondary-ink hover:bg-surface-2")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
