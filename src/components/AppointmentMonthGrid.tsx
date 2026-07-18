import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryListItem } from "../types";
import {
  daySums,
  getWorkAndCompensationMinutes,
  listAppointmentsRange,
  listEntries,
} from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import { toUserMessage } from "../lib/errors";
import { errorBoxCls, secondaryBtnSmCls } from "../lib/ui";
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
import OccurrenceListRow from "./OccurrenceListRow";

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

  const cells = useMemo(() => monthGrid(month), [month]);
  // Ein Map-Lookup pro Zelle statt 42 × O(N)-Filter bei JEDEM Render
  // (Tages-Klick, Lade-/Fehlerzustand); ändert sich nur mit den Daten.
  const occsByDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const c of cells) map.set(c.iso, occurrencesOnDay(occurrences, c.iso));
    return map;
  }, [cells, occurrences]);

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
      if ((occsByDay.get(iso) ?? []).length === 0) {
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

  const navBtn = secondaryBtnSmCls + " min-h-touch-pointer sm:min-h-0";
  const selectedOccs = selectedDay ? occsByDay.get(selectedDay) ?? [] : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" className={navBtn} onClick={() => onShiftMonth(-1)}>
          ‹ Vorheriger
        </button>
        <h3 className="text-base font-semibold capitalize text-primary-ink">
          {monthLabel(month)}
          {(monthWorkMinutes > 0 || monthCompensationMinutes > 0) && (
            <span className="ml-2 text-sm font-normal normal-case text-secondary-ink">
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
        <p className={errorBoxCls}>
          {error}
        </p>
      )}

      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-0.5 text-center text-xs font-medium text-secondary-ink sm:py-1"
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const minutes = sums[c.iso];
          const dayOccs = occsByDay.get(c.iso) ?? [];
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
                  ? "border-border bg-surface hover:border-hover-accent-line hover:bg-hover-accent-surface"
                  : "border-transparent bg-cell-muted text-cell-muted-ink") +
                (selectedDay === c.iso ? " ring-2 ring-selected-ring" : "")
              }
            >
              <span className="flex items-center justify-between text-xs text-day-number-ink">
                {c.date.getDate()}
                {minutes ? (
                  <span
                    className="flex items-center gap-0.5 font-medium text-link"
                    title={`Erfasste Zeit: ${minutesToHhmm(minutes)} Std`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-time-dot" />
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
                <span className="px-1 text-[10px] text-secondary-ink sm:text-xs">
                  +{more} weitere
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tages-Panel: Termine + Einträge des angeklickten Tags */}
      {selectedDay && (
        <div className="rounded border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-primary-ink">
              {formatDateDe(selectedDay)}
            </h4>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-primary px-2 py-1 text-xs font-medium text-on-primary hover:bg-primary-hover"
                onClick={() => onNewAppointment(selectedDay)}
              >
                + Termin
              </button>
              <button
                type="button"
                className="rounded bg-primary px-2 py-1 text-xs font-medium text-on-primary hover:bg-primary-hover"
                onClick={() => onNewEntry(selectedDay)}
              >
                + Eintrag
              </button>
            </div>
          </div>

          {selectedOccs.length > 0 && (
            <ul className="mb-2 space-y-1">
              {selectedOccs.map((o) => (
                <OccurrenceListRow
                  key={`${o.appointment.id}-${o.anchor}`}
                  chipText={formatOccurrenceTime(o) || "Termin"}
                  color={o.appointment.color}
                  title={o.appointment.title}
                  isImportant={o.appointment.isImportant}
                  location={o.appointment.location || undefined}
                  variant="panel"
                  onOpen={() => onOpenOccurrence(o)}
                />
              ))}
            </ul>
          )}

          {dayEntries.length > 0 && (
            <>
              <h5 className="mb-1 text-xs font-medium uppercase tracking-wide text-secondary-ink">
                Erfasste Zeiten
              </h5>
              <ul className="space-y-1">
                {dayEntries.map((e) => (
                  <li
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer rounded border border-border p-2 text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    onClick={() => onOpenEntry(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onOpenEntry(e);
                      }
                    }}
                  >
                    <div className="flex justify-between">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-primary-ink">
                        {e.isCompensation && (
                          <span className="shrink-0 rounded bg-success-surface px-1.5 py-0.5 text-xs text-success-ink">
                            Freizeitausgleich
                          </span>
                        )}
                        <span className="truncate">
                          {e.tagLabels.join(", ") || e.infoForManagement || "Eintrag"}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 font-medium text-primary-ink">
                        {minutesToHhmm(e.durationMinutes)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selectedOccs.length === 0 && dayEntries.length === 0 && (
            <p className="text-sm text-secondary-ink">
              Keine Termine oder Einträge an diesem Tag.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
