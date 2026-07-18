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
}

export default function HistoryView({
  tags,
  reloadKey,
  onOpenEntry,
  onNewEntry,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Historie
        </h2>
      </header>

      <EntryList
        tags={tags}
        reloadKey={reloadKey}
        onOpen={onOpenEntry}
        onNewEntry={() => onNewEntry()}
      />
    </div>
  );
}
