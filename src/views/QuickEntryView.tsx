import { useEffect, useMemo, useRef, useState } from "react";
import { format, subDays } from "date-fns";
import type { EntryListItem, TaskTag, TimeEntry } from "../types";
import { getWorkAndCompensationMinutes, listEntries, newEntry } from "../db/repository";
import { weekRangeIso, formatDateDe, todayIso } from "../lib/calendar";
import { minutesToHhmm } from "../lib/time";
import { toUserMessage } from "../lib/errors";
import EntryForm from "../components/EntryForm";

// Zwischenstand des Erfassen-Formulars, damit ein App-Neustart (z. B. nach
// versehentlichem Schließen) nichts verliert. Enthält bewusst auch
// secretDetails (das BR-Geheimnis): der Draft liegt im localStorage des
// WebView-Profils dieses Windows-Benutzers – genauso lokal/vertraulich wie
// die SQLite-Datenbank selbst, kein zusätzliches Preisgabe-Risiko.
const DRAFT_KEY = "brlog.quickEntryDraft";

function loadDraft(): TimeEntry | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimeEntry;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.date !== "string")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(e: TimeEntry): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(e));
  } catch {
    // nicht kritisch – Persistenz ist nur eine Komfortfunktion
  }
}

/** Löscht den Zwischenstand explizit (z. B. nach Speichern oder bewusstem Verwerfen). */
export function clearQuickEntryDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

interface Props {
  tags: TaskTag[];
  onSaved: () => void; // App: Toast + reloadKey
  onDirtyChange?: (dirty: boolean) => void; // App: sperrt View-Wechsel bei Rückfrage
  onOpenEntry?: (entry: EntryListItem) => void; // Finding 25: letzte Einträge anklickbar
}

export default function QuickEntryView({
  tags,
  onSaved,
  onDirtyChange,
  onOpenEntry,
}: Props) {
  // Nach dem Speichern wird die Maske durch Remount (neuer key) geleert.
  // formKey wird bewusst NICHT im Memo-Body gelesen, sondern dient nur als
  // Trigger für die Neuberechnung -> exhaustive-deps hält ihn für unnötig.
  const [formKey, setFormKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => loadDraft() ?? newEntry(todayIso()), [formKey]);

  // Finding 25: Die Startansicht zeigte ausschließlich das leere Formular --
  // keine Wochensumme, keine letzten Einträge. Wochensumme + letzte 5
  // Einträge geben den direkten Überblick, den ein BR-Mitglied beim Öffnen
  // der App zuerst braucht. Bounded auf die letzten 30 Tage statt eines
  // ungefilterten listEntries({}): vermeidet, für 5 Zeilen den kompletten
  // Datenbestand zu laden (bei Jahren an Historie relevant).
  const [weekMinutes, setWeekMinutes] = useState(0);
  // Finding B2 (Summen-Konsistenz): "Diese Woche" zählte über daySums bisher
  // Freizeitausgleich-Minuten MIT, während die Auswertung (StatsView) sie
  // ausschließt -- getWorkAndCompensationMinutes liefert beide getrennt,
  // Ausgleich wird wie in EntryList/PrintReportPanel separat ausgewiesen.
  const [weekCompensationMinutes, setWeekCompensationMinutes] = useState(0);
  const [recent, setRecent] = useState<EntryListItem[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatsError(null);
    const { from, to } = weekRangeIso(new Date());
    Promise.all([
      getWorkAndCompensationMinutes(from, to),
      listEntries({ from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: todayIso() }),
    ])
      .then(([split, items]) => {
        if (!active) return;
        setWeekMinutes(split.work);
        setWeekCompensationMinutes(split.compensation);
        setRecent(items.slice(0, 5));
      })
      .catch((e) => {
        if (active) setStatsError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
    // formKey ändert sich nur nach dem Speichern -> genau dann sollen
    // Wochensumme/letzte Einträge neu geladen werden.
  }, [formKey]);

  const dirtyRef = useRef(false);
  const dateRef = useRef(entry.date);
  useEffect(() => {
    dateRef.current = entry.date;
  }, [entry]);

  // Mitternachts-Fall: Bleibt die App über Nacht auf "Zeit erfassen" offen,
  // würde das vorbelegte Datum sonst nur beim nächsten Speichern/Remount
  // aktualisiert. Bei Fokus/Sichtbarkeitswechsel gegen "heute" prüfen –
  // aber nur, solange der Entwurf noch unangetastet (nicht dirty) ist, damit
  // eingetippte Daten nie stillschweigend überschrieben werden.
  useEffect(() => {
    const refreshIfStale = () => {
      if (dirtyRef.current) return;
      if (todayIso() !== dateRef.current) setFormKey((k) => k + 1);
    };
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* Wochensumme in der Titelzeile statt eigener Karte (Design-Handoff
          #27, 1b) -- spart eine ganze Kartenhöhe im ohnehin langen Formular. */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-bold text-primary-ink">
            Zeit erfassen
          </h2>
          <p className="text-sm text-secondary-ink">
            Neuer Eintrag für deine Betriebsratszeit.
          </p>
        </div>
        <p className="shrink-0 whitespace-nowrap text-sm text-secondary-ink">
          Woche{" "}
          <span className="font-semibold text-primary-ink">
            {minutesToHhmm(weekMinutes)} Std
          </span>
          {weekCompensationMinutes > 0 && (
            <span className="ml-1 font-normal">
              (+ {minutesToHhmm(weekCompensationMinutes)} Std Freizeitausgleich)
            </span>
          )}
        </p>
      </header>

      {/* Letzte Einträge (Finding 25) -- als schlichte Liste statt eigener
          Karte, seit die Wochensumme in die Titelzeile gewandert ist. */}
      {statsError && <p className="text-xs text-danger-ink">{statsError}</p>}
      {recent.length > 0 && (
        <ul className="space-y-1">
          {recent.map((e) => (
            <li
              key={e.id}
              role={onOpenEntry ? "button" : undefined}
              tabIndex={onOpenEntry ? 0 : undefined}
              className={
                "flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs text-secondary-ink" +
                (onOpenEntry
                  ? " cursor-pointer hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  : "")
              }
              onClick={onOpenEntry ? () => onOpenEntry(e) : undefined}
              onKeyDown={
                onOpenEntry
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onOpenEntry(e);
                      }
                    }
                  : undefined
              }
            >
              <span className="truncate">
                {formatDateDe(e.date)} · {e.infoForManagement || e.tagLabels.join(", ") || "Eintrag"}
              </span>
              <span className="shrink-0 font-medium">{minutesToHhmm(e.durationMinutes)}</span>
            </li>
          ))}
        </ul>
      )}

      <EntryForm
        key={formKey}
        entry={entry}
        tags={tags}
        onSaved={() => {
          clearQuickEntryDraft();
          dirtyRef.current = false;
          onDirtyChange?.(false);
          onSaved();
          setFormKey((k) => k + 1);
        }}
        onDraftChange={(draft, dirty) => {
          dirtyRef.current = dirty;
          onDirtyChange?.(dirty);
          if (dirty) saveDraft(draft);
          else clearQuickEntryDraft();
        }}
      />
    </div>
  );
}
