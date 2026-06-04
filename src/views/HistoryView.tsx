import { useState } from "react";
import type { EntryListItem, TaskTag } from "../types";
import EntryList from "../components/EntryList";
import CalendarView from "../components/CalendarView";

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
  const [sub, setSub] = useState<"liste" | "kalender">("liste");

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Kalender &amp; Historie</h2>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(["liste", "kalender"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSub(s)}
              className={
                "rounded px-3 py-1 " +
                (sub === s
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-50")
              }
            >
              {s === "liste" ? "Liste" : "Kalender"}
            </button>
          ))}
        </div>
      </header>

      {sub === "liste" ? (
        <EntryList
          tags={tags}
          reloadKey={reloadKey}
          onOpen={onOpenEntry}
          onNewEntry={() => onNewEntry()}
        />
      ) : (
        <CalendarView
          reloadKey={reloadKey}
          onOpenEntry={onOpenEntry}
          onNewEntry={onNewEntry}
        />
      )}
    </div>
  );
}
