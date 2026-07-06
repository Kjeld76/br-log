import DbInfoPanel from "./DbInfoPanel";
import SecurityPanel from "./SecurityPanel";
import ThemeToggle from "./ThemeToggle";

interface Props {
  onLockNow: () => void;
  onAutoLockChanged: (minutes: number) => void;
  // Konvention (siehe App.tsx): isAndroid() wird zentral EINMAL in App.tsx
  // ermittelt und als Prop durchgereicht -- hier nur zum Durchreichen an
  // DbInfoPanel gebraucht.
  mobile: boolean;
}

const heading = "mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200";

// Bündelt die drei App-weiten Einstellungsblöcke (Darstellung, Sicherheit,
// Datenbank), die bisher Teil der Daten-Ansicht waren (siehe DataView) --
// jetzt im Einstellungen-Modal, erreichbar über das neue AppMenu. Der
// "Über"-Teil, der zuvor am Ende von DbInfoPanel steckte, ist ausgezogen ins
// eigenständige AboutPanel (eigener Menüpunkt "Über BR-Log").
export default function SettingsPanel({ onLockNow, onAutoLockChanged, mobile }: Props) {
  return (
    <div className="space-y-8">
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

      <section>
        <h3 className={heading}>Sicherheit</h3>
        <SecurityPanel onLockNow={onLockNow} onAutoLockChanged={onAutoLockChanged} />
      </section>

      <section>
        <h3 className={heading}>Datenbank</h3>
        <DbInfoPanel mobile={mobile} />
      </section>
    </div>
  );
}
