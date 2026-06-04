import DbInfoPanel from "../components/DbInfoPanel";
import ExportPanel from "../components/ExportPanel";
import TagManager from "../components/TagManager";
import ThemeToggle from "../components/ThemeToggle";

interface Props {
  onChanged: () => void; // Tags neu laden + Listen aktualisieren
}

export default function DataView({ onChanged }: Props) {
  const heading = "mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200";

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
        Über / Daten
      </h2>

      <section>
        <h3 className={heading}>Darstellung</h3>
        <div className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Erscheinungsbild
            </span>
            <ThemeToggle />
          </div>
        </div>
      </section>

      <DbInfoPanel />

      <section>
        <h3 className={heading}>Export &amp; Backup</h3>
        <ExportPanel onImported={onChanged} />
      </section>

      <section>
        <h3 className={heading}>Schlagwörter verwalten</h3>
        <TagManager onChanged={onChanged} />
      </section>
    </div>
  );
}
