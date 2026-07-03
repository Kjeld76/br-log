import logo from "../assets/logo.png";
import { Icon, type IconName } from "./Icon";

export type View = "erfassen" | "historie" | "auswertung" | "daten";

// Gemeinsame Navigations-Definition für Sidebar (Desktop) UND BottomNav
// (Android) -- EINE Quelle für Reihenfolge/Icon/Label, keine Duplikation
// zwischen den beiden Komponenten (siehe BottomNav.tsx). `label` ist der
// volle Sidebar-Text, `shortLabel` das kompakte Pendant für die schmalen
// Tabs der BottomNav.
export const NAV: { key: View; label: string; shortLabel: string; icon: IconName }[] = [
  { key: "erfassen", label: "Zeit erfassen", shortLabel: "Erfassen", icon: "clock" },
  { key: "historie", label: "Kalender & Historie", shortLabel: "Historie", icon: "calendar" },
  { key: "auswertung", label: "Auswertung", shortLabel: "Auswertung", icon: "bar-chart" },
  { key: "daten", label: "Über / Daten", shortLabel: "Daten", icon: "folder-open" },
];

interface Props {
  view: View;
  onNavigate: (v: View) => void;
  onLockNow: () => void;
}

export default function Sidebar({ view, onNavigate, onLockNow }: Props) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="p-4">
        {/* Markenelement: größer + im Dunkelmodus auf hellem Badge lesbar */}
        <span className="brand-logo-wrap">
          <img src={logo} alt="BR-Log" className="h-12 w-auto" />
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((n) => {
          const active = view === n.key;
          return (
            <button
              key={n.key}
              type="button"
              onClick={() => onNavigate(n.key)}
              className={
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition " +
                (active
                  ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700")
              }
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </button>
          );
        })}
      </nav>

      {/* Sofort sperren – verwirft den Entschlüsselungs-Schlüssel aus dem RAM */}
      <button
        type="button"
        onClick={onLockNow}
        className="mx-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <Icon name="lock" size={18} />
        Jetzt sperren
      </button>

      {/* Dauerhafte Datenschutzzusicherung (klickbar -> Über/Daten) */}
      <button
        type="button"
        onClick={() => onNavigate("daten")}
        className="m-2 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-left text-xs text-slate-500 hover:bg-slate-100 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
        <span>Daten liegen lokal auf diesem Gerät.</span>
      </button>
    </aside>
  );
}
