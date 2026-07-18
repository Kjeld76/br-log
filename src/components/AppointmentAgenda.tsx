import { useEffect, useMemo, useRef, useState } from "react";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import type { AppointmentListItem } from "../types";
import { listAppointmentsRange, searchAppointments } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { errorBoxCls, inputCls, secondaryBtnSmCls } from "../lib/ui";
import { addDaysIso, formatDateDe, todayIso } from "../lib/calendar";
import {
  expandOccurrences,
  occurrencesOnDay,
  formatOccurrenceTime,
  type Occurrence,
} from "../lib/appointments";
import OccurrenceListRow from "./OccurrenceListRow";

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
  // 300-ms-Entprellung (Muster EntryList): eine Abfrage pro Eingabepause
  // statt zwei FTS-/LIKE-Durchläufen pro Tastenanschlag.
  const [debouncedTerm, setDebouncedTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedTerm(term), 300);
    return () => window.clearTimeout(t);
  }, [term]);
  const [results, setResults] = useState<AppointmentListItem[]>([]);
  // GETRENNTE Generationszähler für Fenster-Ladung und Suche: mit einem
  // geteilten Zähler verwarf eine Sucheingabe die noch laufende Range-Antwort
  // endgültig (der Effekt läuft mangels Dep-Änderung nicht erneut) -- die
  // Agenda zeigte dann nach dem Leeren der Suche einen veralteten Stand.
  const requestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);

  const to = addDaysIso(from, days);

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
    const t = debouncedTerm.trim();
    if (!t) {
      setResults([]);
      return;
    }
    const id = ++searchRequestIdRef.current;
    let active = true;
    searchAppointments(t)
      .then((items) => {
        if (active && searchRequestIdRef.current === id) setResults(items);
      })
      .catch((e) => {
        if (active && searchRequestIdRef.current === id) setError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
  }, [debouncedTerm, reloadKey]);

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
  // An debouncedTerm gekoppelt, damit "Keine Termine gefunden" nicht schon
  // während der Eingabepause aufblinkt, bevor die Suche gelaufen ist.
  const searching = debouncedTerm.trim().length > 0;

  // Suchtreffer öffnen. Einzeltermine und Overrides sind selbst die Instanz;
  // ein Serien-MASTER wird dagegen als real existierende Instanz geöffnet
  // (nächste ab heute, sonst die letzte): sein startDate kann per Exdate
  // gelöscht oder durch einen Override ersetzt sein -- die Detailansicht
  // zeigte sonst eine Phantom-Instanz, die im Kalender nicht existiert.
  const openResult = async (a: AppointmentListItem) => {
    if (a.rrule !== null && a.parentId === null) {
      try {
        const horizon = addDaysIso(today, 366);
        const items = await listAppointmentsRange(a.startDate, horizon);
        const series = expandOccurrences(items, a.startDate, horizon).filter(
          (o) => o.appointment.id === a.id || o.appointment.parentId === a.id
        );
        const next =
          series.find((o) => o.endDate >= today) ?? series[series.length - 1];
        if (next) {
          onOpenOccurrence(next);
          return;
        }
      } catch {
        // Fallback unten: lieber die Roh-Instanz zeigen als gar nichts.
      }
    }
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
        <p className={errorBoxCls}>
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
              <OccurrenceListRow
                key={a.id}
                chipText={formatDateDe(a.startDate)}
                color={a.color}
                title={a.title}
                isImportant={a.isImportant}
                titleSuffix={a.rrule ? "(Serie)" : undefined}
                secretHit={a.search?.hasSecretHit}
                onOpen={() => void openResult(a)}
              />
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
              <OccurrenceListRow
                key={`${o.appointment.id}-${o.anchor}-${g.iso}`}
                chipText={formatOccurrenceTime(o) || "Termin"}
                color={o.appointment.color}
                title={o.appointment.title}
                isImportant={o.appointment.isImportant}
                location={o.appointment.location || undefined}
                onOpen={() => onOpenOccurrence(o)}
              />
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
