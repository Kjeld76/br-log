import { useEffect, useRef, useState } from "react";
import type { EntryListItem } from "../types";
import { daySums, listEntries } from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import { toUserMessage } from "../lib/errors";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  monthRangeIso,
  formatDateDe,
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
  const [error, setError] = useState<string | null>(null);

  const cells = monthGrid(month);
  const monthMinutes = Object.values(sums).reduce((s, m) => s + m, 0);

  // Finding 53: weder der Lade-Effekt noch handleDayClick hatten einen
  // Race-Guard. requestIdRef markiert jeden Monats-/Reload-Wechsel als neue
  // "Generation" -- eine spät auflösende Antwort einer überholten Generation
  // (Out-of-order-Resolution beim schnellen Blättern, oder ein während des
  // Awaits gewechselter Monat) wird verworfen, statt falsche Summen oder das
  // Tages-Panel des falschen Monats zu zeigen. Kombiniert mit Finding 22:
  // beide Aufrufe hatten weder catch noch Nutzer-Feedback.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    let active = true;
    const { from, to } = monthRangeIso(month);
    setError(null);
    daySums(from, to)
      .then((s) => {
        if (active && requestIdRef.current === id) setSums(s);
      })
      .catch((e) => {
        if (active && requestIdRef.current === id) setError(toUserMessage(e));
      });
    setSelectedDay(null);
    setDayEntries([]);
    return () => {
      active = false;
    };
  }, [month, reloadKey]);

  const handleDayClick = async (iso: string) => {
    const minutes = sums[iso];
    if (!minutes) {
      onNewEntry(iso);
      return;
    }
    // Eigene Generation je Klick (nicht nur je Monat/Reload): zwei schnell
    // aufeinanderfolgende Tages-Klicks dürfen sich nicht überholen -- sonst
    // gewinnt ggf. die zuerst gestartete, aber später auflösende Anfrage und
    // zeigt das Panel des falsch angeklickten Tages.
    const id = ++requestIdRef.current;
    try {
      const items = await listEntries({ from: iso, to: iso });
      if (requestIdRef.current !== id) return; // überholt (Monat/Reload/neuerer Klick)
      setSelectedDay(iso);
      setDayEntries(items);
    } catch (e) {
      if (requestIdRef.current === id) setError(toUserMessage(e));
    }
  };

  const navBtn =
    "rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={navBtn}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          ‹ Vorheriger
        </button>
        <h3 className="text-base font-semibold capitalize text-slate-800 dark:text-slate-100">
          {monthLabel(month)}
          {monthMinutes > 0 && (
            <span className="ml-2 text-sm font-normal normal-case text-slate-500 dark:text-slate-400">
              ({minutesToHhmm(monthMinutes)} Std)
            </span>
          )}
        </h3>
        <button
          type="button"
          className={navBtn}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          Nächster ›
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400"
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
                  ? "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-slate-700"
                  : "border-transparent bg-slate-50 text-slate-400 dark:bg-slate-900/40 dark:text-slate-600") +
                (selectedDay === c.iso ? " ring-2 ring-sky-400" : "")
              }
            >
              <span className="text-xs dark:text-slate-300">
                {c.date.getDate()}
              </span>
              {hasEntries && (
                <span className="mt-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <span className="text-xs font-medium text-sky-700 dark:text-sky-400">
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
        <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Einträge am {formatDateDe(selectedDay)}
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
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded border border-slate-100 p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:hover:bg-slate-700"
                onClick={() => onOpenEntry(e)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onOpenEntry(e);
                  }
                }}
              >
                <div className="flex justify-between">
                  <span className="truncate text-slate-700 dark:text-slate-200">
                    {e.tagLabels.join(", ") || e.infoForManagement || "Eintrag"}
                  </span>
                  <span className="ml-2 shrink-0 font-medium text-slate-700 dark:text-slate-200">
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
