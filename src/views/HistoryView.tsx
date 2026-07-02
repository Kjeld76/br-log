import { useState } from "react";
import type { EntryListItem, TaskTag } from "../types";
import EntryList from "../components/EntryList";
import CalendarView from "../components/CalendarView";

type SubTab = "liste" | "kalender";

// Finding 29: Der Sub-Tab stand hart auf "liste" (useState ohne Persistenz);
// da App.tsx HistoryView nur bei view==="historie" rendert, wurde die
// Komponente bei jedem Sidebar-Wechsel unmountet -- die bevorzugte Wahl
// (insbesondere der Kalender-Weg, der einzige gute Nacherfassungs-Weg der App)
// ging so bei jedem View-Wechsel verloren, nicht erst beim Neustart.
const SUB_TAB_KEY = "brlog.historySubTab";

export function loadHistorySubTab(): SubTab {
  try {
    return localStorage.getItem(SUB_TAB_KEY) === "kalender" ? "kalender" : "liste";
  } catch {
    return "liste";
  }
}

function saveHistorySubTab(v: SubTab): void {
  try {
    localStorage.setItem(SUB_TAB_KEY, v);
  } catch {
    // Persistenz ist nur Komfort, kein Pflichtpfad.
  }
}

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
  const [sub, setSub] = useState<SubTab>(() => loadHistorySubTab());
  const selectSub = (s: SubTab) => {
    setSub(s);
    saveHistorySubTab(s);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Kalender &amp; Historie
        </h2>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm dark:border-slate-700 dark:bg-slate-800">
          {(["liste", "kalender"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => selectSub(s)}
              className={
                "rounded px-3 py-1 " +
                (sub === s
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700")
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
