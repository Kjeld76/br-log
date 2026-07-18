import { useEffect, useState } from "react";
import type { EntryListItem, TaskTag } from "../types";
import { listEntries } from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import { formatDateDe } from "../lib/calendar";
import { toUserMessage } from "../lib/errors";
import { toggleId } from "../lib/collections";
import { errorBoxCls, inputCls } from "../lib/ui";
import TagFilterChips from "./TagFilterChips";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  tags: TaskTag[];
  reloadKey: number;
  onOpen: (entry: EntryListItem) => void;
  onNewEntry: () => void;
}

export default function EntryList({
  tags,
  reloadKey,
  onOpen,
  onNewEntry,
}: Props) {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Finding 22: listEntries hatte weder catch noch Nutzer-Feedback -- bei
  // einem DB-Fehler blieb die Liste leer/veraltet und zeigte "0 Einträge",
  // als gäbe es keine Daten. error trennt jetzt "keine Treffer" von "Fehler".
  const [error, setError] = useState<string | null>(null);

  // Suche entprellen (300 ms).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listEntries({
      term: debouncedTerm.trim() || undefined,
      tagIds: tagIds.length ? tagIds : undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then((res) => {
        if (active) setEntries(res);
      })
      .catch((e) => {
        if (active) setError(toUserMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedTerm, tagIds, from, to, reloadKey]);

  // Finding 14: Freizeitausgleich-Einträge sind keine BR-Tätigkeit -- aus der
  // BR-Zeit-Summe herausgehalten und separat ausgewiesen statt sie zu vermischen.
  const totalMinutes = entries
    .filter((e) => !e.isCompensation)
    .reduce((s, e) => s + e.durationMinutes, 0);
  const compensationMinutes = entries
    .filter((e) => e.isCompensation)
    .reduce((s, e) => s + e.durationMinutes, 0);
  const searching = debouncedTerm.trim().length > 0;

  const toggleTag = (id: string) => setTagIds((cur) => toggleId(cur, id));

  const field = inputCls;

  return (
    <div className="space-y-3">
      {/* Such- und Filterleiste (sticky) */}
      <div className="sticky top-0 z-10 space-y-2 bg-background pb-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={field + " min-w-[12rem] flex-1"}
            placeholder="Volltextsuche (Info, vertraulich, Schlagwörter, Widersprüche)…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover"
            onClick={onNewEntry}
          >
            + Neuer Eintrag
          </button>
        </div>

        <TagFilterChips
          tags={tags}
          selected={tagIds}
          onToggle={toggleTag}
          onClear={() => setTagIds([])}
        />

        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary-ink">
          <span>Zeitraum:</span>
          <input
            type="date"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span>–</span>
          <input
            type="date"
            className={field}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {(from || to) && (
            <button
              type="button"
              className="text-xs text-secondary-ink hover:underline"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Zeitraum löschen
            </button>
          )}
        </div>
      </div>

      {/* Summenzeile */}
      <div className="flex items-center justify-between rounded bg-surface-inset px-3 py-2 text-sm text-primary-ink">
        <span>
          {loading
            ? "Lädt…"
            : error
            ? "Fehler beim Laden"
            : `${entries.length} Einträge`}
        </span>
        <span className="font-medium">
          Summe: {minutesToHhmm(totalMinutes)} Std
          {compensationMinutes > 0 && (
            <span className="ml-1 font-normal text-secondary-ink">
              (+ {minutesToHhmm(compensationMinutes)} Std Freizeitausgleich)
            </span>
          )}
        </span>
      </div>

      {error && (
        <p className={errorBoxCls}>
          {error}
        </p>
      )}

      {/* Liste */}
      <ul className="space-y-2">
        {entries.map((e) => (
          <li
            key={e.id}
            role="button"
            tabIndex={0}
            className="cursor-pointer rounded border border-border bg-surface p-3 hover:border-sky-300 hover:bg-sky-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus dark:hover:border-sky-700 dark:hover:bg-slate-700/60"
            onClick={() => onOpen(e)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onOpen(e);
              }
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-primary-ink">
                    {formatDateDe(e.date)}
                  </span>
                  {e.startTime && e.endTime && (
                    <span className="text-xs text-secondary-ink">
                      {e.startTime}–{e.endTime}
                      {e.pauseMinutes > 0 && ` (Pause ${e.pauseMinutes} Min)`}
                    </span>
                  )}
                  {e.isCompensation && (
                    <span className="rounded bg-success-surface px-1.5 py-0.5 text-xs text-success-ink">
                      Freizeitausgleich
                    </span>
                  )}
                  {!e.isCompensation && !e.hadPlannedShift && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      keine geplante Schicht
                    </span>
                  )}
                  {e.objections.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-error-badge px-1.5 py-0.5 text-xs text-error-badge-ink">
                      <Icon name="alert-triangle" size={11} />
                      {e.objections.length} Widerspruch
                      {e.objections.length > 1 ? "e" : ""}
                    </span>
                  )}
                </div>
                {e.tagLabels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.tagLabels.map((l) => (
                      <TagChip key={l} variant="readonly" label={l} />
                    ))}
                  </div>
                )}
                {e.infoForManagement && (
                  <p className="mt-1 truncate text-sm text-secondary-ink">
                    {e.infoForManagement}
                  </p>
                )}
                {/* Geheimnis-Schutz: bei Treffer in vertraulichem Feld KEIN Inhalt, nur Label */}
                {searching && e.search?.hasSecretHit && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-confidential">
                    <Icon name="lock" size={12} />
                    Treffer in vertraulichem Feld (Inhalt nur in der Einzelansicht)
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold text-primary-ink">
                  {minutesToHhmm(e.durationMinutes)}
                </div>
                <div className="text-xs text-secondary-ink">Std</div>
              </div>
            </div>
          </li>
        ))}
        {!loading && !error && entries.length === 0 && (
          <li className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-secondary-ink dark:border-slate-700">
            Keine Einträge gefunden.
          </li>
        )}
      </ul>
    </div>
  );
}
