import { useEffect, useState } from "react";
import type { EntryListItem } from "../types";
import { daySums, listEntries } from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  monthRangeIso,
  WEEKDAYS,
} from "../lib/calendar";

interface Props {
  reloadKey: number;
  onOpenEntry: (entry: EntryListItem) => void;
  onNewEntry: (iso: string) => void;
}

export default function CalendarView({
  reloadKey,
  onOpenEntry,
  onNewEntry,
}: Props) {
  const [month, setMonth] = useState<Date>(() => new Date());
  const [sums, setSums] = useState<Record<string, number>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<EntryListItem[]>([]);

  const cells = monthGrid(month);

  useEffect(() => {
    const { from, to } = monthRangeIso(month);
    daySums(from, to).then(setSums);
    setSelectedDay(null);
    setDayEntries([]);
  }, [month, reloadKey]);

  const handleDayClick = async (iso: string) => {
    const minutes = sums[iso];
    if (!minutes) {
      onNewEntry(iso);
      return;
    }
    const items = await listEntries({ from: iso, to: iso });
    setSelectedDay(iso);
    setDayEntries(items);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          ‹ Vorheriger
        </button>
        <h3 className="text-base font-semibold capitalize text-slate-800">
          {monthLabel(month)}
        </h3>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          Nächster ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-xs font-medium text-slate-500"
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const minutes = sums[c.iso];
          const hasEntries = !!minutes;
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => handleDayClick(c.iso)}
              className={
                "flex min-h-[3.5rem] flex-col items-start rounded border p-1 text-left transition " +
                (c.inMonth
                  ? "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50"
                  : "border-transparent bg-slate-50 text-slate-400") +
                (selectedDay === c.iso ? " ring-2 ring-sky-400" : "")
              }
            >
              <span className="text-xs">{c.date.getDate()}</span>
              {hasEntries && (
                <span className="mt-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <span className="text-[10px] font-medium text-sky-700">
                    {minutesToHhmm(minutes)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tages-Panel bei belegtem Tag */}
      {selectedDay && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">
              Einträge am {selectedDay}
            </h4>
            <button
              type="button"
              className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
              onClick={() => onNewEntry(selectedDay)}
            >
              + Neuer Eintrag
            </button>
          </div>
          <ul className="space-y-1">
            {dayEntries.map((e) => (
              <li
                key={e.id}
                className="cursor-pointer rounded border border-slate-100 p-2 text-sm hover:bg-slate-50"
                onClick={() => onOpenEntry(e)}
              >
                <div className="flex justify-between">
                  <span className="truncate">
                    {e.tagLabels.join(", ") || e.infoForManagement || "Eintrag"}
                  </span>
                  <span className="ml-2 shrink-0 font-medium">
                    {minutesToHhmm(e.durationMinutes)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
