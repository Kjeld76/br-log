import type { EntryListItem, TaskTag } from "../types";
import EntryList from "../components/EntryList";

// Seit dem Terminkalender ist die Monatsansicht in den eigenen Haupt-Tab
// "Kalender" (CalendarPage) umgezogen -- Historie ist nur noch die Liste.
// Der frühere Sub-Tab (SegmentedControl "Liste/Kalender", localStorage
// brlog.historySubTab, Finding 29) entfällt damit ersatzlos.

interface Props {
  tags: TaskTag[];
  reloadKey: number;
  onOpenEntry: (entry: EntryListItem) => void;
  onNewEntry: (iso?: string) => void;
  // Steuert in EntryList den FAB (Android) vs. den Button oben (Desktop) --
  // siehe EntryList.tsx (Design-Handoff #27, 1d).
  mobile?: boolean;
}

export default function HistoryView({
  tags,
  reloadKey,
  onOpenEntry,
  onNewEntry,
  mobile,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary-ink">
          Historie
        </h2>
      </header>

      <EntryList
        tags={tags}
        reloadKey={reloadKey}
        onOpen={onOpenEntry}
        onNewEntry={() => onNewEntry()}
        mobile={mobile}
      />
    </div>
  );
}
