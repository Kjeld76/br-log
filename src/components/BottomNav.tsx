import { NAV, type View } from "./Sidebar";
import { Icon } from "./Icon";

// Android-Pendant zur Sidebar (Desktop): dieselbe NAV-Definition (siehe
// Sidebar.tsx), aber als unten fixierte Tab-Leiste statt fester Spalte --
// eine feste 224px breite Sidebar (siehe Sidebar.tsx, w-56) ist im Portrait-
// Format auf einem Handy praktisch nicht tragbar. Wird ausschließlich
// gerendert, wenn App.tsx `mobile` (isAndroid()) ermittelt hat; hier selbst
// KEIN erneuter isAndroid()-Aufruf (siehe Konvention: zentral in App.tsx).
interface Props {
  view: View;
  onNavigate: (v: View) => void;
}

export default function BottomNav({ view, onNavigate }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV.map((n) => {
        const active = view === n.key;
        return (
          <button
            key={n.key}
            type="button"
            onClick={() => onNavigate(n.key)}
            aria-current={active ? "page" : undefined}
            className={
              "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition " +
              (active
                ? "text-sky-700 dark:text-sky-300"
                : "text-slate-500 dark:text-slate-400")
            }
          >
            <Icon name={n.icon} size={20} />
            <span className="leading-none">{n.shortLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}
