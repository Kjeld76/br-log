import ExportPanel from "../components/ExportPanel";
import PrintReportPanel from "../components/PrintReportPanel";
import TagManager from "../components/TagManager";

interface Props {
  onChanged: () => void; // Tags neu laden + Listen aktualisieren
  reloadKey: number; // Finding 33: hält TagManager nach einem Import synchron
}

// Daten-Ansicht: NUR noch Datenfunktionen (Export/Backup, Nachweis-Druck,
// Schlagwörter). Darstellung/Sicherheit/Datenbank sind ausgezogen ins neue
// Einstellungen-Modal (AppMenu -> "Einstellungen", siehe SettingsPanel) --
// diese Ansicht mischte bisher App-Einstellungen mit Datenfunktionen, ohne
// klare Trennung.
export default function DataView({ onChanged, reloadKey }: Props) {
  const heading = "mb-2 text-sm font-semibold text-primary-ink";

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4">
      <h2 className="text-lg font-bold text-primary-ink">
        Daten
      </h2>

      <section>
        <h3 className={heading}>Export &amp; Backup</h3>
        <ExportPanel onImported={onChanged} />
      </section>

      <section>
        <h3 className={heading}>Nachweis drucken</h3>
        <PrintReportPanel />
      </section>

      <section>
        <h3 className={heading}>Schlagwörter verwalten</h3>
        <TagManager onChanged={onChanged} reloadKey={reloadKey} />
      </section>
    </div>
  );
}
