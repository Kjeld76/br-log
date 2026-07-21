import { useEffect, useId, useState } from "react";
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
  // Android: "+ Neuer Eintrag" wird zum FAB in der Daumenzone statt eines
  // Textbuttons oben (Design-Handoff #27, 1d). Am Desktop bleibt der
  // Button erhalten -- ein bildschirmfester FAB ist dort keine sinnvolle
  // Bedienmetapher (Handoff, Abschnitt "Desktop-Fassung" / "Df").
  mobile?: boolean;
}

// Kurzform "tt.mm." fürs Filter-Chip-Label: die App-weite formatDateDe()
// liefert bewusst Wochentag + Jahr ("Mo, 12.03.2026") für Eintragsdaten --
// auf dem schmalen Chip wäre das zu lang, daher hier eine eigene, rein
// darstellende Kurzform ohne date-fns-Import.
function shortDe(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.` : iso;
}

export default function EntryList({
  tags,
  reloadKey,
  onOpen,
  onNewEntry,
  mobile = false,
}: Props) {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Datums-Zeitraum hinter Filter-Chip/Disclosure (Design-Handoff #27, 1d)
  // statt zwei dauerhaft sichtbarer Datumsfelder -- Schlagwort-Filter
  // bleiben unabhängig davon immer sichtbar (TagFilterChips unten).
  const [rangeOpen, setRangeOpen] = useState(false);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Finding 22: listEntries hatte weder catch noch Nutzer-Feedback -- bei
  // einem DB-Fehler blieb die Liste leer/veraltet und zeigte "0 Einträge",
  // als gäbe es keine Daten. error trennt jetzt "keine Treffer" von "Fehler".
  const [error, setError] = useState<string | null>(null);
  const rangePanelId = useId();

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

  // Ein aktiver Zeitraum muss am Chip selbst erkennbar sein (nicht erst nach
  // dem Aufklappen) -- sonst würde ein wirksamer, aber eingeklappter Filter
  // unbemerkt weiterlaufen (Bedienfehler-Risiko). Label zeigt daher die
  // konkreten Grenzen, Chip wechselt zusätzlich in die "aktiv"-Farbe (wie
  // TagChip variant="selectable" active).
  const rangeActive = !!(from || to);
  const rangeLabel =
    from && to
      ? `${shortDe(from)}–${shortDe(to)}`
      : from
      ? `ab ${shortDe(from)}`
      : to
      ? `bis ${shortDe(to)}`
      : "Filter";

  return (
    <div className="space-y-3">
      {/* Such- und Filterleiste (sticky) */}
      <div className="sticky top-0 z-sticky space-y-2 bg-background pb-2 pt-1">
        {/* Große Suche zuerst (Design-Handoff #27, 1d): ~46 px hohes Feld mit
            führendem Lupen-Icon, statt kleinem Feld neben dem Anlegen-Button. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-disabled-ink"
            />
            <input
              className={field + " h-[46px] w-full pl-10"}
              placeholder="Volltextsuche (Info, vertraulich, Schlagwörter, Widersprüche)…"
              aria-label="Volltextsuche"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          {/* Desktop behält den prominenten Button oben (Handoff, Desktop-
              Fassung "Df"); auf Android übernimmt der FAB unten (s. u.). */}
          {!mobile && (
            <button
              type="button"
              className="shrink-0 rounded bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover"
              onClick={onNewEntry}
            >
              + Neuer Eintrag
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <TagFilterChips
            tags={tags}
            selected={tagIds}
            onToggle={toggleTag}
            onClear={() => setTagIds([])}
          />
          <button
            type="button"
            aria-expanded={rangeOpen}
            aria-controls={rangePanelId}
            onClick={() => setRangeOpen((v) => !v)}
            className={
              "inline-flex min-h-touch-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition " +
              (rangeActive
                ? "border-primary bg-primary text-on-primary"
                : "border-border-strong bg-surface text-secondary-ink hover:bg-surface-2")
            }
          >
            <Icon name="filter" size={13} />
            {rangeLabel}
          </button>
        </div>

        {rangeOpen && (
          <div
            id={rangePanelId}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-dim p-2 text-sm text-secondary-ink"
          >
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
            {rangeActive && (
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
        )}
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
            className="cursor-pointer rounded border border-border bg-surface p-3 hover:border-hover-accent-line hover:bg-hover-accent-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => onOpen(e)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onOpen(e);
              }
            }}
          >
            <div className="flex items-start justify-between gap-2">
              {/* Anker der Karte: Datum + Dauer (Design-Handoff #27, 1d).
                  Badges (Tags/Status) stehen einheitlich als Pillen in einer
                  eigenen Zeile unter der Info statt mit dem Datum vermischt. */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-primary-ink">
                    {formatDateDe(e.date)}
                  </span>
                  {e.startTime && e.endTime && (
                    <span className="text-xs text-secondary-ink">
                      {e.startTime}–{e.endTime}
                      {e.pauseMinutes > 0 && ` (Pause ${e.pauseMinutes} Min)`}
                    </span>
                  )}
                </div>

                {e.infoForManagement && (
                  <p className="mt-1 truncate text-sm text-secondary-ink">
                    {e.infoForManagement}
                  </p>
                )}

                {(e.tagLabels.length > 0 ||
                  e.isCompensation ||
                  (!e.isCompensation && !e.hadPlannedShift) ||
                  e.objections.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.tagLabels.map((l) => (
                      <TagChip key={l} variant="readonly" label={l} />
                    ))}
                    {e.isCompensation && (
                      <span className="rounded-full bg-success-surface px-2 py-0.5 text-xs text-success-ink">
                        Freizeitausgleich
                      </span>
                    )}
                    {!e.isCompensation && !e.hadPlannedShift && (
                      <span className="rounded-full bg-warning-badge px-2 py-0.5 text-xs text-warning-badge-ink">
                        keine geplante Schicht
                      </span>
                    )}
                    {e.objections.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-error-badge px-2 py-0.5 text-xs text-error-badge-ink">
                        <Icon name="alert-triangle" size={11} />
                        {e.objections.length} Widerspruch
                        {e.objections.length > 1 ? "e" : ""}
                      </span>
                    )}
                  </div>
                )}

                {/* Geheimnis-Schutz: bei Treffer in vertraulichem Feld KEIN Inhalt, nur
                    Label. confidential-blur kommt ADDITIV oben drauf (Issue #17, Task 8)
                    -- dieses Label verrät bereits, dass DIESER Eintrag zum Suchbegriff
                    einen Treffer im vertraulichen Feld hat, deshalb bei Fokusverlust
                    zusätzlich geblurrt statt nur der eigentliche Klartext. */}
                {searching && e.search?.hasSecretHit && (
                  <p className="confidential-blur mt-1 flex items-center gap-1 text-xs font-medium text-confidential">
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
          <li className="rounded border border-dashed border-empty-line p-6 text-center text-sm text-secondary-ink">
            Keine Einträge gefunden.
          </li>
        )}
      </ul>

      {/* FAB "+ Neuer Eintrag" in der Daumenzone (Design-Handoff #27, 1d) --
          nur Android; Desktop behält den Button oben (s. o.). BottomNav ist
          fix 64px hoch (min-h-[64px]), durch Pille + Label + Innenabstand
          real ca. 68-70px; `bottom-20` (5rem/80px, Tailwind-Skalenwert statt
          des vormals geratenen `bottom-[5.5rem]`) lässt darüber ein eigenes
          ca. 10-16px-Sicherheitspolster (Material-FAB-Gutter), damit der FAB
          die Leiste auch bei größerer Systemschrift nie verdeckt. Seit die
          BottomNav kein `fixed`-Overlay mehr ist (s. Kommentar in
          BottomNav.tsx), braucht der FAB dafür keine Rücksicht mehr auf ein
          Scroll-Padding zu nehmen -- er ist ohnehin `fixed` und damit
          unabhängig vom Scroll-Container positioniert. */}
      {mobile && (
        <button
          type="button"
          onClick={onNewEntry}
          aria-label="Neuer Eintrag"
          title="Neuer Eintrag"
          className="fixed bottom-20 right-4 z-sticky flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-token-3 transition hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon name="plus" size={24} />
        </button>
      )}
    </div>
  );
}
