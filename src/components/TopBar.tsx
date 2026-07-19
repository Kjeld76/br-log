import { NAV, type View } from "./Sidebar";
import AppMenu from "./AppMenu";

// Schmale Kopfzeile für Android (Portrait), Ersatz für den oberen Teil der
// Sidebar (Desktop). Zeigt nach dem Android-Top-App-Bar-Muster den Titel der
// aktiven Ansicht (aus der geteilten NAV-Definition, shortLabel) links und
// rechts das neue App-Menü (⋮) -- Ersatz für den früheren alleinstehenden
// "Jetzt sperren"-Button: Sperren ist jetzt ein Menüpunkt, Auto-Lock beim
// Verlassen der App sichert ohnehin ab. Das Marken-Logo ist nach Marios
// Gerätetest bewusst raus ("würde auch beim Login reichen") -- es hängt jetzt
// mobil-gated im LockScreen. Die dauerhafte Datenschutz-Zusicherung der
// Sidebar ("Daten liegen lokal auf diesem Gerät") entfällt mobil ersatzlos --
// derselbe Hinweis (ausführlicher) steht jetzt im Einstellungen-Modal
// (Block "Datenbank"), einen Tipp vom ⋮-Menü entfernt.
interface Props {
  view: View;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onLockNow: () => void;
}

export default function TopBar({ view, onOpenSettings, onOpenAbout, onLockNow }: Props) {
  const title = NAV.find((n) => n.key === view)?.shortLabel ?? "BR-Log";
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface py-1.5 pl-4 pr-2">
      <h1 className="text-base font-semibold text-primary-ink">
        {title}
      </h1>
      <AppMenu
        variant="topbar"
        onOpenSettings={onOpenSettings}
        onOpenAbout={onOpenAbout}
        onLockNow={onLockNow}
      />
    </header>
  );
}
