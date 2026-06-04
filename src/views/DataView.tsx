import DbInfoPanel from "../components/DbInfoPanel";
import ExportPanel from "../components/ExportPanel";
import TagManager from "../components/TagManager";

interface Props {
  onChanged: () => void; // Tags neu laden + Listen aktualisieren
}

export default function DataView({ onChanged }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4">
      <h2 className="text-lg font-bold text-slate-800">Über / Daten</h2>

      <DbInfoPanel />

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Export &amp; Backup
        </h3>
        <ExportPanel onImported={onChanged} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Schlagwörter verwalten
        </h3>
        <TagManager onChanged={onChanged} />
      </section>
    </div>
  );
}
