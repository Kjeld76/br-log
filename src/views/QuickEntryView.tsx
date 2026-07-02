import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import type { TaskTag, TimeEntry } from "../types";
import { newEntry } from "../db/repository";
import EntryForm from "../components/EntryForm";

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

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
}

export default function QuickEntryView({ tags, onSaved, onDirtyChange }: Props) {
  // Nach dem Speichern wird die Maske durch Remount (neuer key) geleert.
  // formKey wird bewusst NICHT im Memo-Body gelesen, sondern dient nur als
  // Trigger für die Neuberechnung -> exhaustive-deps hält ihn für unnötig.
  const [formKey, setFormKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => loadDraft() ?? newEntry(todayIso()), [formKey]);

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
      <header>
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Zeit erfassen
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Neuer Eintrag für deine Betriebsratszeit.
        </p>
      </header>
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
