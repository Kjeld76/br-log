import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import type { AppointmentListItem } from "../types";
import { listAppointmentsRange, searchAppointments } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { inputCls, secondaryBtnSmCls } from "../lib/ui";
import { formatDateDe, todayIso } from "../lib/calendar";
import {
  expandOccurrences,
  occurrencesOnDay,
  formatOccurrenceTime,
  type Occurrence,
} from "../lib/appointments";
import { chipClsFor } from "../lib/appointmentUi";
import { Icon } from "./Icon";

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
  // Volltextsuche über ALLE Termine (nicht nur das Agenda-Fenster) --
  // spaltengebundene Trefferherkunft wie die Eintragssuche (SearchHit).
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<AppointmentListItem[]>([]);
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

  // Suche: eigene Generation je Termwechsel (Race-Guard-Muster).
  useEffect(() => {
    const t = term.trim();
    if (!t) {
      setResults([]);
      return;
    }
    const id = ++requestIdRef.current;
    let active = true;
    searchAppointments(t)
      .then((items) => {
        if (active && requestIdRef.current === id) setResults(items);
      })
      .catch((e) => {
        if (active && requestIdRef.current === id) setError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
  }, [term, reloadKey]);

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
  const searching = term.trim().length > 0;

  // Suchtreffer öffnen: als Instanz an seinem (Original-)Starttag.
  const openResult = (a: AppointmentListItem) => {
    onOpenOccurrence({
      appointment: a,
      anchor: a.recurrenceAnchor ?? a.startDate,
      startDate: a.startDate,
      startTime: a.startTime,
      endDate: a.endDate,
      endTime: a.endTime,
    });
  };

  return (
    <div className="space-y-3">
      <input
        type="search"
        className={inputCls + " w-full"}
        placeholder="Termine durchsuchen (Titel, Ort, Beschreibung, vertraulich)…"
        aria-label="Termine durchsuchen"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {searching && (
        <>
          {results.length === 0 && !error && (
            <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              Keine Termine gefunden.
            </p>
          )}
          <ul className="space-y-1">
            {results.map((a) => (
              <li
                key={a.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                onClick={() => openResult(a)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    openResult(a);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-xs " + chipClsFor(a.color)
                      }
                    >
                      {formatDateDe(a.startDate)}
                    </span>
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      {a.isImportant && (
                        <span className="font-semibold" title="Wichtig">
                          !{" "}
                        </span>
                      )}
                      {a.title || "(ohne Titel)"}
                      {a.rrule && (
                        <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                          (Serie)
                        </span>
                      )}
                    </span>
                  </span>
                  {a.search?.hasSecretHit && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-xs font-medium text-confidential"
                      title="Treffer im vertraulichen Feld"
                    >
                      <Icon name="lock" size={12} />
                      vertraulich
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!searching && groups.length === 0 && !error && (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Keine Termine bis {formatDateDe(to)}.
        </p>
      )}

      {!searching &&
        groups.map((g) => (
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

      {!searching && (
        <div className="flex justify-center">
          <button
            type="button"
            className={secondaryBtnSmCls}
            onClick={() => setDays((d) => d + WINDOW_DAYS)}
          >
            Weitere {WINDOW_DAYS} Tage laden
          </button>
        </div>
      )}
    </div>
  );
}
