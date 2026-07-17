import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import { listAppointmentsRange } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { secondaryBtnSmCls } from "../lib/ui";
import { formatDateDe, todayIso } from "../lib/calendar";
import {
  expandOccurrences,
  occurrencesOnDay,
  formatOccurrenceTime,
  type Occurrence,
} from "../lib/appointments";
import { chipClsFor } from "../lib/appointmentUi";

/** Fenstergröße der Agenda in Tagen; "Mehr laden" verlängert um denselben Wert. */
const WINDOW_DAYS = 60;

interface Props {
  reloadKey: number;
  onOpenOccurrence: (occ: Occurrence) => void;
}

export default function AppointmentAgenda({ reloadKey, onOpenOccurrence }: Props) {
  // Startpunkt der Agenda bleibt für die Lebensdauer der Ansicht "heute beim
  // Öffnen" -- ein Mitternachts-Wechsel während der Sitzung verschiebt die
  // Liste nicht unter dem Nutzer weg.
  const fromRef = useRef(todayIso());
  const from = fromRef.current;
  const [days, setDays] = useState(WINDOW_DAYS);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const to = format(addDays(parseISO(from), days), "yyyy-MM-dd");

  useEffect(() => {
    const id = ++requestIdRef.current;
    let active = true;
    setError(null);
    listAppointmentsRange(from, to)
      .then((appts) => {
        if (!active || requestIdRef.current !== id) return;
        setOccurrences(expandOccurrences(appts, from, to));
      })
      .catch((e) => {
        if (active && requestIdRef.current === id) setError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
  }, [from, to, reloadKey]);

  // Nur Tage mit Terminen rendern (mehrtägige erscheinen an jedem berührten Tag).
  const groups = useMemo(() => {
    const allDays = eachDayOfInterval({
      start: parseISO(from),
      end: parseISO(to),
    }).map((d) => format(d, "yyyy-MM-dd"));
    return allDays
      .map((iso) => ({ iso, occs: occurrencesOnDay(occurrences, iso) }))
      .filter((g) => g.occs.length > 0);
  }, [occurrences, from, to]);

  const today = todayIso();

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {groups.length === 0 && !error && (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Keine Termine bis {formatDateDe(to)}.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.iso}>
          <h4
            className={
              "mb-1 text-sm font-semibold " +
              (g.iso === today
                ? "text-sky-700 dark:text-sky-400"
                : "text-slate-700 dark:text-slate-200")
            }
          >
            {formatDateDe(g.iso)}
            {g.iso === today && " · Heute"}
          </h4>
          <ul className="space-y-1">
            {g.occs.map((o) => (
              <li
                key={`${o.appointment.id}-${o.anchor}-${g.iso}`}
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
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
        </div>
      ))}

      <div className="flex justify-center">
        <button
          type="button"
          className={secondaryBtnSmCls}
          onClick={() => setDays((d) => d + WINDOW_DAYS)}
        >
          Weitere {WINDOW_DAYS} Tage laden
        </button>
      </div>
    </div>
  );
}
