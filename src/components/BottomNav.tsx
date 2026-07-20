import { NAV, type View } from "./Sidebar";
import { Icon } from "./Icon";

// Android-Pendant zur Sidebar (Desktop): dieselbe NAV-Definition (siehe
// Sidebar.tsx), aber als unten fixierte Tab-Leiste statt fester Spalte --
// eine feste 224px breite Sidebar (siehe Sidebar.tsx, w-56) ist im Portrait-
// Format auf einem Handy praktisch nicht tragbar. Wird ausschließlich
// gerendert, wenn App.tsx `mobile` (isAndroid()) ermittelt hat; hier selbst
// KEIN erneuter isAndroid()-Aufruf (siehe Konvention: zentral in App.tsx).
//
// Kein env(safe-area-inset-bottom) nötig: Die Gestenleiste hält nativ
// MainActivity per Insets-Padding frei (env() liefert in der Android-WebView
// ohnehin 0px), bottom-0 endet also bereits oberhalb der Systemleiste.
//
// Aktiv-Indikator nach Material-3-Muster (Navigation Bar): getönte Pill
// hinter dem Icon + kräftigeres Label, nicht nur ein Farbwechsel des Texts.
interface Props {
  view: View;
  onNavigate: (v: View) => void;
}

export default function BottomNav({ view, onNavigate }: Props) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface">
      {/* Leiste 64px (vorher 48px) und Pille 32x56px (vorher 28x56px) --
          größere Touch-Ziele für die Daumenzone (Design-Handoff #27, 1a). */}
      {NAV.map((n) => {
        const active = view === n.key;
        return (
          <button
            key={n.key}
            type="button"
            onClick={() => onNavigate(n.key)}
            aria-current={active ? "page" : undefined}
            className={
              "flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition " +
              (active
                ? "font-medium text-primary-outline-ink"
                : "text-secondary-ink")
            }
          >
            <span
              className={
                "flex h-8 w-14 items-center justify-center rounded-full transition " +
                (active ? "bg-info-badge" : "")
              }
            >
              <Icon name={n.icon} size={22} />
            </span>
            <span className="leading-none">{n.shortLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}
