import type { AppointmentColor } from "../types";
import { chipClsFor } from "../lib/appointmentUi";
import { Icon } from "./Icon";

// Die EINE Termin-Listenzeile (Farb-Chip + Wichtig-Marker + Titel + rechte
// Zusatzinfo) samt Tastatur-Aktivierung -- vorher dreifach nahezu identisch
// ausgeschrieben (Agenda-Suchtreffer, Agenda-Tagesgruppen, Tages-Panel des
// Monatsrasters), inklusive bereits sichtbarer Drift (Serien-/Vertraulich-
// Badge nur in einer Kopie).

interface Props {
  /** Chip-Inhalt: Zeitspanne der Instanz oder Datum (Suchtreffer). */
  chipText: string;
  color: AppointmentColor | null;
  title: string;
  isImportant: boolean;
  /** Zusatz hinter dem Titel, z. B. "(Serie)". */
  titleSuffix?: string;
  /** Rechte Seite: Ortsangabe (ab sm sichtbar) ... */
  location?: string;
  /** ... oder Vertraulich-Badge (Suchtreffer im geschützten Feld). */
  secretHit?: boolean;
  /** "card" = eigenständige Karte (Agenda), "panel" = im Tages-Panel. */
  variant?: "card" | "panel";
  onOpen: () => void;
}

const FRAME = {
  card: "cursor-pointer rounded border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700",
  panel:
    "cursor-pointer rounded border border-slate-100 p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:hover:bg-slate-700",
};

export default function OccurrenceListRow({
  chipText,
  color,
  title,
  isImportant,
  titleSuffix,
  location,
  secretHit,
  variant = "card",
  onOpen,
}: Props) {
  return (
    <li
      role="button"
      tabIndex={0}
      className={FRAME[variant]}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={"shrink-0 rounded px-1.5 py-0.5 text-xs " + chipClsFor(color)}
          >
            {chipText}
          </span>
          <span className="truncate text-slate-700 dark:text-slate-200">
            {isImportant && (
              <span className="font-semibold" title="Wichtig">
                !{" "}
              </span>
            )}
            {title || "(ohne Titel)"}
            {titleSuffix && (
              <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                {titleSuffix}
              </span>
            )}
          </span>
        </span>
        {secretHit && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-confidential"
            title="Treffer im vertraulichen Feld"
          >
            <Icon name="lock" size={12} />
            vertraulich
          </span>
        )}
        {!secretHit && location && (
          <span className="ml-2 hidden shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:inline">
            {location}
          </span>
        )}
      </div>
    </li>
  );
}
