import logo from "../assets/logo.png";
import { Icon } from "./Icon";

// Schmale Kopfzeile für Android (Portrait), Ersatz für den oberen Teil der
// Sidebar (Desktop). Übernimmt von der Sidebar NUR das Marken-Logo und den
// "Jetzt sperren"-Button; die 4 Views wandern in BottomNav, die dauerhafte
// Datenschutz-Zusicherung ("Daten liegen lokal auf diesem Gerät") entfällt
// hier ersatzlos -- derselbe Hinweis (ausführlicher) steht bereits in
// DbInfoPanel unter "Über / Daten", ein Tab, der von der BottomNav aus immer
// einen Tipp entfernt ist.
interface Props {
  onLockNow: () => void;
}

export default function TopBar({ onLockNow }: Props) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
      <span className="brand-logo-wrap">
        <img src={logo} alt="BR-Log" className="h-8 w-auto" />
      </span>
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
