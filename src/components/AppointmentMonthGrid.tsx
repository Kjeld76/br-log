import { useEffect, useRef, useState } from "react";
import type { EntryListItem } from "../types";
import {
  daySums,
  getWorkAndCompensationMinutes,
  listAppointmentsRange,
  listEntries,
} from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import { toUserMessage } from "../lib/errors";
import { secondaryBtnSmCls } from "../lib/ui";
import {
  monthGrid,
  monthLabel,
  monthRangeIso,
  formatDateDe,
  WEEKDAYS,
} from "../lib/calendar";
import {
  expandOccurrences,
  occurrencesOnDay,
  formatOccurrenceTime,
  continuesFromPreviousDay,
  continuesToNextDay,
  type Occurrence,
} from "../lib/appointments";
import { chipClsFor } from "../lib/appointmentUi";

/** Maximal angezeigte Termin-Chips je Tageszelle; Rest als "+n weitere". */
const MAX_CHIPS_PER_DAY = 3;

interface Props {
  month: Date;
  onShiftMonth: (delta: number) => void;
  reloadKey: number;
  onOpenEntry: (entry: EntryListItem) => void;
  onNewEntry: (iso: string) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  onNewAppointment: (iso: string) => void;
}

export default function AppointmentMonthGrid({
  month,
  onShiftMonth,
  reloadKey,
  onOpenEntry,
  onNewEntry,
  onOpenOccurrence,
  onNewAppointment,
}: Props) {
  const [sums, setSums] = useState<Record<string, number>>({});
  const [monthWorkMinutes, setMonthWorkMinutes] = useState(0);
  const [monthCompensationMinutes, setMonthCompensationMinutes] = useState(0);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<EntryListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cells = monthGrid(month);

  // Race-Guard-Muster der bisherigen CalendarView (Finding 53) -- aber mit
  // GETRENNTEN Zählern: Ein Tages-Klick während des Monats-Ladens darf die
  // laufende Monats-Antwort nicht verwerfen (Summen/Chips blieben sonst bis
  // zum nächsten Monats-/Reload-Wechsel leer). Der Monats-Wechsel invalidiert
  // umgekehrt sehr wohl laufende Tages-Abfragen.
  const requestIdRef = useRef(0);
  const dayRequestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    dayRequestIdRef.current++;
    let active = true;
    const { from, to } = monthRangeIso(month);
    // Termine über den VOLLEN Grid-Bereich laden (inkl. Randzellen der
    // Nachbarmonate): die Zellen sind klickbar und das Tages-Panel würde
    // sonst fälschlich "keine Termine" für existierende Termine melden.
    const gridCells = monthGrid(month);
    const gridFrom = gridCells[0].iso;
    const gridTo = gridCells[gridCells.length - 1].iso;
    setError(null);
    Promise.all([
      daySums(from, to),
      getWorkAndCompensationMinutes(from, to),
      listAppointmentsRange(gridFrom, gridTo),
    ])
      .then(([s, split, appts]) => {
        if (!active || requestIdRef.current !== id) return;
        setSums(s);
        setMonthWorkMinutes(split.work);
        setMonthCompensationMinutes(split.compensation);
        setOccurrences(expandOccurrences(appts, gridFrom, gridTo));
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
      dayRequestIdRef.current++; // laufende Tages-Abfragen invalidieren
      if (occurrencesOnDay(occurrences, iso).length === 0) {
        // Komplett leerer Tag: direkt das vorbefüllte Eintragsformular --
        // der Ein-Klick-Nacherfassungs-Weg der alten CalendarView.
        onNewEntry(iso);
        return;
      }
      // Ohne erfasste Zeit ist das Eintrags-Ergebnis vorhersagbar leer --
      // Panel (mit Terminen) ohne listEntries-Roundtrip öffnen.
      setSelectedDay(iso);
      setDayEntries([]);
      return;
    }
    const id = ++dayRequestIdRef.current;
    try {
      const items = await listEntries({ from: iso, to: iso });
      if (dayRequestIdRef.current !== id) return;
      setSelectedDay(iso);
      setDayEntries(items);
    } catch (e) {
      if (dayRequestIdRef.current === id) setError(toUserMessage(e));
    }
  };

  const navBtn = secondaryBtnSmCls + " min-h-[44px] sm:min-h-0";
  const selectedOccs = selectedDay ? occurrencesOnDay(occurrences, selectedDay) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" className={navBtn} onClick={() => onShiftMonth(-1)}>
          ‹ Vorheriger
        </button>
        <h3 className="text-base font-semibold capitalize text-slate-800 dark:text-slate-100">
          {monthLabel(month)}
          {(monthWorkMinutes > 0 || monthCompensationMinutes > 0) && (
            <span className="ml-2 text-sm font-normal normal-case text-slate-500 dark:text-slate-400">
              ({minutesToHhmm(monthWorkMinutes)} Std
              {monthCompensationMinutes > 0 &&
                ` · + ${minutesToHhmm(monthCompensationMinutes)} Std Freizeitausgleich`}
              )
            </span>
          )}
        </h3>
        <button type="button" className={navBtn} onClick={() => onShiftMonth(1)}>
          Nächster ›
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-0.5 text-center text-xs font-medium text-slate-500 dark:text-slate-400 sm:py-1"
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const minutes = sums[c.iso];
          const dayOccs = occurrencesOnDay(occurrences, c.iso);
          const shown = dayOccs.slice(0, MAX_CHIPS_PER_DAY);
          const more = dayOccs.length - shown.length;
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => void handleDayClick(c.iso)}
              className={
                "flex min-h-[4rem] flex-col items-stretch gap-0.5 rounded border p-0.5 text-left transition sm:min-h-[5rem] sm:p-1 " +
                (c.inMonth
                  ? "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-700 dark:hover:bg-slate-700"
                  : "border-transparent bg-slate-50 text-slate-400 dark:bg-slate-900/40 dark:text-slate-600") +
                (selectedDay === c.iso ? " ring-2 ring-sky-400" : "")
              }
            >
              <span className="flex items-center justify-between text-xs dark:text-slate-300">
                {c.date.getDate()}
                {minutes ? (
                  <span
                    className="flex items-center gap-0.5 font-medium text-sky-700 dark:text-sky-400"
                    title={`Erfasste Zeit: ${minutesToHhmm(minutes)} Std`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                    {/* Auf allen Breiten sichtbar: das Raster ist für
                        Android-Portrait getunt; ein title-Tooltip ist auf
                        Touch nicht erreichbar. */}
                    <span>{minutesToHhmm(minutes)}</span>
                  </span>
                ) : null}
              </span>
              {shown.map((o) => {
                const cont = continuesFromPreviousDay(o, c.iso);
                const goesOn = continuesToNextDay(o, c.iso);
                return (
                  <span
                    key={`${o.appointment.id}-${o.anchor}`}
                    className={
                      "truncate rounded px-1 text-[10px] leading-4 sm:text-xs sm:leading-5 " +
                      chipClsFor(o.appointment.color) +
                      (o.appointment.isImportant ? " font-semibold" : "")
                    }
                    title={
                      (o.appointment.isImportant ? "Wichtig: " : "") +
                      o.appointment.title +
                      (o.appointment.isAllDay ? "" : ` (${formatOccurrenceTime(o)})`)
                    }
                  >
                    {cont && "‹ "}
                    {o.appointment.isImportant && "! "}
                    {o.appointment.title || "(ohne Titel)"}
                    {goesOn && " ›"}
                  </span>
                );
              })}
              {more > 0 && (
                <span className="px-1 text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">
                  +{more} weitere
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tages-Panel: Termine + Einträge des angeklickten Tags */}
      {selectedDay && (
        <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {formatDateDe(selectedDay)}
            </h4>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
                onClick={() => onNewAppointment(selectedDay)}
              >
                + Termin
              </button>
              <button
                type="button"
                className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
                onClick={() => onNewEntry(selectedDay)}
              >
                + Eintrag
              </button>
            </div>
          </div>

          {selectedOccs.length > 0 && (
            <ul className="mb-2 space-y-1">
              {selectedOccs.map((o) => (
                <li
                  key={`${o.appointment.id}-${o.anchor}`}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer rounded border border-slate-100 p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:hover:bg-slate-700"
                  onClick={() => onOpenOccurrence(o)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onOpenOccurrence(o);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={
                          "shrink-0 rounded px-1.5 py-0.5 text-xs " +
                          chipClsFor(o.appointment.color)
                        }
                      >
                        {formatOccurrenceTime(o) || "Termin"}
                      </span>
                      <span className="truncate text-slate-700 dark:text-slate-200">
                        {o.appointment.isImportant && (
                          <span className="font-semibold" title="Wichtig">
                            !{" "}
                          </span>
                        )}
                        {o.appointment.title || "(ohne Titel)"}
                      </span>
                    </span>
                    {o.appointment.location && (
                      <span className="ml-2 hidden shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:inline">
                        {o.appointment.location}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {dayEntries.length > 0 && (
            <>
              <h5 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Erfasste Zeiten
              </h5>
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
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-700 dark:text-slate-200">
                        {e.isCompensation && (
                          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            Freizeitausgleich
                          </span>
                        )}
                        <span className="truncate">
                          {e.tagLabels.join(", ") || e.infoForManagement || "Eintrag"}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 font-medium text-slate-700 dark:text-slate-200">
                        {minutesToHhmm(e.durationMinutes)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selectedOccs.length === 0 && dayEntries.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Keine Termine oder Einträge an diesem Tag.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
