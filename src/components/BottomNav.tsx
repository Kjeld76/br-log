import { NAV, type View } from "./Sidebar";
import { Icon } from "./Icon";

// Android-Pendant zur Sidebar (Desktop): dieselbe NAV-Definition (siehe
// Sidebar.tsx), aber als Tab-Leiste am unteren Bildschirmrand statt fester
// Spalte -- eine feste 224px breite Sidebar (siehe Sidebar.tsx, w-56) ist im
// Portrait-Format auf einem Handy praktisch nicht tragbar. Wird ausschließlich
// gerendert, wenn App.tsx `mobile` (isAndroid()) ermittelt hat; hier selbst
// KEIN erneuter isAndroid()-Aufruf (siehe Konvention: zentral in App.tsx).
//
// Bewusst NICHT `position: fixed` (Layout-Korrektur, #27-Review): eine fixe
// Leiste sitzt unabhängig vom jeweiligen Scroll-Container immer am Viewport-
// Boden -- ein `sticky bottom-0` im Erfassen-Formular (EntryForm, dort direkt
// in `main` eingebettet) pinnte dadurch UNTER dieser Leiste statt darüber,
// weil `main`s eigener Scrollport ohne Rücksicht auf die (vormals fixe)
// Leiste über die volle Viewport-Höhe reichte; das `pb-[4.5rem]` an `main`
// verschob nur scrollenden Inhalt, nicht die Sticky-Kante. Jetzt ist
// BottomNav (`shrink-0`) stattdessen das letzte Flex-Kind der
// `h-full flex-col`-Wurzel in App.tsx: `main` (`flex-1`) füllt exakt den
// Platz darüber und endet am echten oberen Rand dieser Leiste -- `sticky
// bottom-0`-Elemente in `main` pinnen damit korrekt direkt oberhalb der Nav,
// ganz ohne Padding-Reservierung oder geratene Offsets. Modals (`z-overlay`,
// `fixed inset-0`) decken die Leiste weiterhin vollständig ab, unabhängig
// von ihrer Position im normalen Fluss.
//
// Kein env(safe-area-inset-bottom) nötig: Die Gestenleiste hält nativ
// MainActivity per Insets-Padding frei (env() liefert in der Android-WebView
// ohnehin 0px) -- der `h-full`-Wurzelcontainer ist dadurch bereits um die
// Systemleisten verkleinert, das letzte Flex-Kind endet also von selbst
// oberhalb der Gestenleiste.
//
// Aktiv-Indikator nach Material-3-Muster (Navigation Bar): getönte Pill
// hinter dem Icon + kräftigeres Label, nicht nur ein Farbwechsel des Texts.
interface Props {
  view: View;
  onNavigate: (v: View) => void;
}

export default function BottomNav({ view, onNavigate }: Props) {
  return (
    <nav className="flex shrink-0 border-t border-border bg-surface">
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
