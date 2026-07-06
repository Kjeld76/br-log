import { NAV, type View } from "./Sidebar";
import { Icon } from "./Icon";

// Schmale Kopfzeile für Android (Portrait), Ersatz für den oberen Teil der
// Sidebar (Desktop). Zeigt nach dem Android-Top-App-Bar-Muster den Titel der
// aktiven Ansicht (aus der geteilten NAV-Definition, shortLabel) links und
// den "Jetzt sperren"-Button rechts. Das Marken-Logo ist nach Marios
// Gerätetest bewusst raus ("würde auch beim Login reichen") -- es hängt jetzt
// mobil-gated im LockScreen. Die dauerhafte Datenschutz-Zusicherung der
// Sidebar ("Daten liegen lokal auf diesem Gerät") entfällt mobil ersatzlos --
// derselbe Hinweis (ausführlicher) steht bereits in DbInfoPanel unter
// "Über / Daten", ein Tab, der von der BottomNav aus immer einen Tipp
// entfernt ist.
interface Props {
  view: View;
  onLockNow: () => void;
}

export default function TopBar({ view, onLockNow }: Props) {
  const title = NAV.find((n) => n.key === view)?.shortLabel ?? "BR-Log";
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white py-1.5 pl-4 pr-2 dark:border-slate-700 dark:bg-slate-800">
      <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
        {title}
      </h1>
      <button
        type="button"
        onClick={onLockNow}
        aria-label="Jetzt sperren"
        title="Jetzt sperren"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <Icon name="lock" size={20} />
      </button>
    </header>
  );
}
