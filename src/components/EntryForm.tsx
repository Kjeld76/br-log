import { useEffect, useId, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import type { TimeEntry, TaskTag } from "../types";
import { saveEntry, listEntries } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import {
  addMinutesToTime,
  computeDuration,
  durationInputToMinutes,
  minutesToHhmm,
  formatDurationFull,
  rangesOverlap,
} from "../lib/time";
import { toggleId } from "../lib/collections";
import { inputCls, secondaryBtnCls } from "../lib/ui";
import ObjectionEditor from "./ObjectionEditor";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  entry: TimeEntry;
  tags: TaskTag[];
  onSaved: () => void;
  onCancel?: () => void; // optional: im Seiten-Modus (Startseite) ausgeblendet
  // Meldet jede Änderung am Entwurf + ob er vom Ausgangszustand abweicht.
  // Trägt sowohl die Dirty-Prüfung (Backdrop/Escape/View-Wechsel) als auch die
  // Draft-Persistenz der aufrufenden View (siehe QuickEntryView).
  onDraftChange?: (draft: TimeEntry, dirty: boolean) => void;
  // Optionale externe Ref auf das Datumsfeld (Finding B5): App.tsx übergibt
  // hier dieselbe Ref, die useModalFocusTrap als initialFocusRef bekommt --
  // damit die Fokusfalle des Modals gezielt das Datumsfeld fokussiert statt
  // (mangels Kenntnis der Formular-internen Reihenfolge) das erste
  // fokussierbare Element im Dialog, z. B. den "Übernehmen"-Hinweis-Button.
  dateInputRef?: React.RefObject<HTMLInputElement>;
}

type Mode = "range" | "duration";

const QUICK_MINUTES = [15, 30, 45, 60, 90, 120];
const LAST_DEFAULTS_KEY = "brlog.lastEntryDefaults";

interface LastDefaults {
  tagIds: string[];
  infoForManagement: string;
  hadPlannedShift: boolean;
}

function loadLastDefaults(): LastDefaults | null {
  try {
    const raw = localStorage.getItem(LAST_DEFAULTS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as LastDefaults;
    if (!Array.isArray(d.tagIds) || typeof d.infoForManagement !== "string") return null;
    return d;
  } catch {
    return null;
  }
}

function saveLastDefaults(d: LastDefaults): void {
  try {
    localStorage.setItem(LAST_DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    // localStorage kann in seltenen Fällen (z. B. Kontingent) fehlschlagen -> ignorieren,
    // die Vorauswahl ist nur eine Erleichterung, kein Pflichtpfad.
  }
}

function initialMode(entry: TimeEntry): Mode {
  return !entry.startTime && !entry.endTime && entry.durationMinutes > 0
    ? "duration"
    : "range";
}

function initialDurationText(entry: TimeEntry, mode: Mode): string {
  return mode === "duration" && entry.durationMinutes > 0
    ? minutesToHhmm(entry.durationMinutes)
    : "";
}

export default function EntryForm({
  entry,
  tags,
  onSaved,
  onCancel,
  onDraftChange,
  dateInputRef: externalDateInputRef,
}: Props) {
  const [draft, setDraft] = useState<TimeEntry>(entry);
  const [mode, setMode] = useState<Mode>(() => initialMode(entry));
  const [durationText, setDurationText] = useState(() =>
    initialDurationText(entry, initialMode(entry))
  );
  const [error, setError] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [objOpen, setObjOpen] = useState(entry.objections.length > 0);
  const ownDateInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = externalDateInputRef ?? ownDateInputRef;

  // Finding 41: Labels waren nicht per htmlFor/id mit ihren Feldern verknüpft
  // (Screenreader/Klick-auf-Label funktionierte nicht). useId liefert pro
  // Formular-Instanz eindeutige IDs, falls das Formular mehrfach im DOM steht.
  const idPrefix = useId();
  const dateId = `${idPrefix}-date`;
  const startId = `${idPrefix}-start`;
  const endId = `${idPrefix}-end`;
  const durationId = `${idPrefix}-duration`;
  const infoId = `${idPrefix}-info`;
  const secretId = `${idPrefix}-secret`;
  const shiftNoteId = `${idPrefix}-shift-note`;

  // Ausgangszustand für den Dirty-Check (Backdrop-Klick, Abbrechen, Escape,
  // View-Wechsel). Bleibt über die Lebensdauer der Komponente unverändert.
  const baselineRef = useRef(
    JSON.stringify({ draft: entry, mode: initialMode(entry), durationText: initialDurationText(entry, initialMode(entry)) })
  );
  const lastDefaults = useMemo(() => loadLastDefaults(), []);

  // Erstes Feld beim Öffnen fokussieren (Modal wie Startseite). dateInputRef
  // ist entweder eine stabile lokale useRef-Instanz oder eine vom Aufrufer
  // übergebene, ebenfalls stabile Ref (App.tsx hält sie in einer useRef-
  // Variable) -- absichtlich nur beim Mount, kein Re-Fokus bei Folge-Renders.
  useEffect(() => {
    dateInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<TimeEntry>) => setDraft((d) => ({ ...d, ...p }));

  // Dirty-Zustand + Entwurf nach oben melden (Draft-Persistenz, Wechsel-Sperre).
  useEffect(() => {
    const dirty =
      JSON.stringify({ draft, mode, durationText }) !== baselineRef.current;
    onDraftChange?.(draft, dirty);
    // Ein Überlappungs-/Wertehinweis von vorher gilt nicht mehr, sobald sich
    // die Zeitangaben ändern.
    setOverlapWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, mode, durationText]);

  const toggleTag = (id: string) => patch({ tagIds: toggleId(draft.tagIds, id) });

  // Zugewiesene Tags (auch archivierte, damit sie sichtbar/entfernbar bleiben).
  const assignedTags = tags.filter((t) => draft.tagIds.includes(t.id));
  // Im Picker neu zuweisbar sind nur aktive Schlagwörter.
  const pickableTags = tags.filter((t) => !t.archived);

  const rangeDuration = computeDuration(draft.startTime, draft.endTime);
  const durationPreviewMinutes =
    mode === "range" ? rangeDuration.minutes : durationInputToMinutes(durationText);
  const durationPreviewError =
    mode === "range" ? rangeDuration.error : null;

  const showLastDefaultsHint =
    !!lastDefaults &&
    draft.tagIds.length === 0 &&
    !draft.infoForManagement.trim() &&
    (lastDefaults.tagIds.length > 0 || lastDefaults.infoForManagement.trim() !== "");

  const applyLastDefaults = () => {
    if (!lastDefaults) return;
    patch({
      tagIds: lastDefaults.tagIds,
      infoForManagement: lastDefaults.infoForManagement,
      hadPlannedShift: lastDefaults.hadPlannedShift,
    });
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    if (m === "duration") {
      patch({ startTime: null, endTime: null, durationMinutes: 0 });
    } else {
      setDurationText("");
      patch({ durationMinutes: 0 });
    }
  };

  // durationMinutes im Draft wird auch im Dauer-Modus live mitgeführt (nicht nur
  // beim Speichern berechnet) – nur so kann ein Neustart-Draft (Persistenz in
  // QuickEntryView) den Dauer-Modus korrekt wiederherstellen.
  const setDurationTextAndDraft = (v: string) => {
    setDurationText(v);
    const mins = durationInputToMinutes(v);
    patch({ durationMinutes: mins ?? 0 });
  };

  const nowHhmm = () => format(new Date(), "HH:mm");

  const applyQuickMinutes = (mins: number) => {
    if (mode === "duration") {
      setDurationTextAndDraft(String(mins));
      return;
    }
    const start = draft.startTime ?? nowHhmm();
    const end = addMinutesToTime(start, mins);
    patch({ startTime: start, endTime: end ?? draft.endTime });
  };

  // Warnt (nicht-blockierend) vor Überschneidungen mit bestehenden Einträgen
  // desselben oder des Vortags – inkl. Über-Mitternacht-Schichten des Vortags.
  const findOverlap = async (start: string, end: string) => {
    const prevDayIso = format(addDays(parseISO(draft.date), -1), "yyyy-MM-dd");
    const nearby = await listEntries({ from: prevDayIso, to: draft.date });
    return nearby.find(
      (e) =>
        e.id !== draft.id &&
        e.startTime &&
        e.endTime &&
        rangesOverlap(
          { date: draft.date, start, end },
          { date: e.date, start: e.startTime, end: e.endTime }
        )
    );
  };

  const handleSave = async (opts?: { skipOverlapCheck?: boolean }) => {
    setError(null);
    if (!draft.date) return setError("Bitte ein Datum angeben.");

    let finalStart: string | null = null;
    let finalEnd: string | null = null;
    let finalMinutes: number;

    if (mode === "range") {
      if (!draft.startTime || !draft.endTime)
        return setError("Bitte Von und Bis angeben.");
      const duration = computeDuration(draft.startTime, draft.endTime);
      if (duration.error) return setError(duration.error);
      if (duration.minutes === null)
        return setError("Die Dauer muss größer als 0 sein.");
      finalStart = draft.startTime;
      finalEnd = draft.endTime;
      finalMinutes = duration.minutes;
    } else {
      const mins = durationInputToMinutes(durationText);
      if (mins === null)
        return setError("Bitte eine Dauer angeben (z. B. 1:30 oder 90).");
      if (mins <= 0) return setError("Die Dauer muss größer als 0 sein.");
      finalMinutes = mins;
    }

    // Ein Freizeitausgleich-Eintrag ist keine BR-Tätigkeit (Finding 14) --
    // Info für die GL ist dafür kein sinnvolles Pflichtfeld, die Felder sind
    // im Formular entsprechend gesperrt (s. u.).
    if (!draft.isCompensation && !draft.infoForManagement.trim())
      return setError("Info für die Geschäftsleitung ist ein Pflichtfeld.");

    if (mode === "range" && finalStart && finalEnd && !opts?.skipOverlapCheck) {
      const conflict = await findOverlap(finalStart, finalEnd);
      if (conflict) {
        setOverlapWarning(
          `Überschneidet sich mit dem Eintrag vom ${conflict.date}, ${conflict.startTime}–${conflict.endTime}` +
            (conflict.infoForManagement ? ` (${conflict.infoForManagement})` : "") +
            ". Trotzdem speichern?"
        );
        return;
      }
    }
    setOverlapWarning(null);

    setSaving(true);
    try {
      const toSave: TimeEntry = {
        ...draft,
        startTime: finalStart,
        endTime: finalEnd,
        durationMinutes: finalMinutes,
      };
      await saveEntry(toSave);
      saveLastDefaults({
        tagIds: toSave.tagIds,
        infoForManagement: toSave.infoForManagement,
        hadPlannedShift: toSave.hadPlannedShift,
      });
      onSaved();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Tastaturkürzel: Strg/Cmd+Enter speichert, Escape bricht ab (Dirty-Check
  // übernimmt der Aufrufer über onCancel, siehe App.tsx/QuickEntryView).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!saving) void handleSave();
      } else if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, mode, durationText, saving, onCancel]);

  const field = inputCls + " w-full";
  const labelCls =
    "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";
  const blockCls =
    "space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800";

  return (
    <div className="space-y-4">
      {showLastDefaultsHint && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
          <span>Wie beim letzten Eintrag übernehmen?</span>
          <button
            type="button"
            className="rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
            onClick={applyLastDefaults}
          >
            Übernehmen
          </button>
        </div>
      )}

      {/* Block 1: Zeit & Art */}
      <div className={blockCls}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Zeit &amp; Art
          </h3>
          <div className="flex overflow-hidden rounded-full border border-slate-300 text-xs dark:border-slate-600">
            <button
              type="button"
              className={
                "px-3 py-1 " +
                (mode === "range"
                  ? "bg-sky-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")
              }
              onClick={() => switchMode("range")}
            >
              Von/Bis
            </button>
            <button
              type="button"
              className={
                "px-3 py-1 " +
                (mode === "duration"
                  ? "bg-sky-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")
              }
              onClick={() => switchMode("duration")}
            >
              Dauer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor={dateId} className={labelCls}>
              Datum <span className="text-red-500">*</span>
            </label>
            <input
              id={dateId}
              ref={dateInputRef}
              type="date"
              className={field}
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </div>

          {mode === "range" ? (
            <>
              <div>
                <label htmlFor={startId} className={labelCls}>
                  Von <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-1">
                  <input
                    id={startId}
                    type="time"
                    className={field}
                    value={draft.startTime ?? ""}
                    onChange={(e) => patch({ startTime: e.target.value || null })}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    title="Aktuelle Uhrzeit übernehmen"
                    onClick={() => patch({ startTime: nowHhmm() })}
                  >
                    Jetzt
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor={endId} className={labelCls}>
                  Bis <span className="text-red-500">*</span>
                </label>
                <input
                  id={endId}
                  type="time"
                  className={field}
                  value={draft.endTime ?? ""}
                  onChange={(e) => patch({ endTime: e.target.value || null })}
                />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <label htmlFor={durationId} className={labelCls}>
                Dauer (Std:Min oder Minuten) <span className="text-red-500">*</span>
              </label>
              <input
                id={durationId}
                type="text"
                inputMode="numeric"
                placeholder="z. B. 1:30 oder 90"
                className={field}
                value={durationText}
                onChange={(e) => setDurationTextAndDraft(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Schnellwahl. Portrait-Feinschliff (Android): min-h-[44px] hebt die
            Tap-Größe der häufig genutzten Minuten-Chips unter der sm-Grenze
            an (inline-flex+items-center zentriert den Text dabei weiterhin
            wie im Standard-Button-Rendering); ab sm: exakt wie zuvor. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Schnellwahl:
          </span>
          {QUICK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-300 px-3 py-0.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 sm:min-h-0 sm:px-2.5"
              onClick={() => applyQuickMinutes(m)}
            >
              {m} Min
            </button>
          ))}
        </div>

        <div>
          <label className={labelCls}>
            {mode === "range" ? "Dauer (automatisch berechnet)" : "Dauer"}
          </label>
          <div
            className={
              "rounded border p-2 text-sm " +
              (durationPreviewError
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
                : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300")
            }
          >
            {durationPreviewError
              ? durationPreviewError
              : durationPreviewMinutes !== null
              ? `${formatDurationFull(durationPreviewMinutes)}${
                  mode === "range" && rangeDuration.overnight
                    ? " – über Mitternacht"
                    : ""
                }`
              : "— noch keine gültige Eingabe —"}
          </div>
        </div>

        {/* Schlagwörter: Dropdown + sichtbare Chips. Bei Freizeitausgleich
            gesperrt (Finding 14: ein Ausgleichs-Eintrag ist keine BR-Tätigkeit). */}
        <div
          className={
            draft.isCompensation ? "pointer-events-none opacity-40" : undefined
          }
          aria-disabled={draft.isCompensation}
        >
          <label className={labelCls}>Schlagwörter / Aufgaben</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {assignedTags.map((t) => (
              <TagChip
                key={t.id}
                variant="removable"
                label={t.label}
                archived={t.archived}
                disabled={draft.isCompensation}
                onClick={() => toggleTag(t.id)}
              />
            ))}
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 sm:min-h-0"
              onClick={() => setTagPickerOpen((v) => !v)}
              disabled={draft.isCompensation}
            >
              {tagPickerOpen ? "Fertig ▴" : "+ Schlagwort ▾"}
            </button>
          </div>
          {tagPickerOpen && (
            <div className="mt-2 flex flex-wrap gap-1.5 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/50">
              {pickableTags.length === 0 && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Keine Schlagwörter – unter „Über / Daten" anlegen.
                </span>
              )}
              {pickableTags.map((t) => (
                <TagChip
                  key={t.id}
                  variant="selectable"
                  label={t.label}
                  active={draft.tagIds.includes(t.id)}
                  onClick={() => toggleTag(t.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Geplante Schicht */}
        <div className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.hadPlannedShift}
              onChange={(e) => patch({ hadPlannedShift: e.target.checked })}
            />
            Geplante Schicht zu dieser Zeit
          </label>
          {!draft.hadPlannedShift && (
            <div>
              <label htmlFor={shiftNoteId} className={labelCls}>
                Schichtausgleich (z. B. andere Schicht streichen lassen / getauscht)
              </label>
              <textarea
                id={shiftNoteId}
                className={field}
                rows={2}
                value={draft.shiftCompensationNote}
                onChange={(e) =>
                  patch({ shiftCompensationNote: e.target.value })
                }
              />
            </div>
          )}
        </div>

        {/* Freizeitausgleich (Finding 14, § 37 Abs. 3 BetrVG): ein genommener
            Ausgleich ist keine BR-Tätigkeit -- Tags/GL-Info/Vertraulich werden
            deaktiviert statt eine fachlich sinnlose Dokumentation zu erzwingen. */}
        <div className="space-y-1 rounded border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!draft.isCompensation}
              onChange={(e) => patch({ isCompensation: e.target.checked })}
            />
            Freizeitausgleich genommen (§ 37 Abs. 3 BetrVG)
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Keine BR-Tätigkeit – Schlagwörter, GL-Info und vertrauliche Details
            sind hier nicht relevant und werden gesperrt. Fließt separat in
            den Freizeitausgleich-Saldo der Auswertung ein.
          </p>
        </div>
      </div>

      {/* Block 2: Dokumentation -- bei Freizeitausgleich komplett gesperrt. */}
      <div
        className={
          "space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800" +
          (draft.isCompensation ? " pointer-events-none opacity-40" : "")
        }
        aria-disabled={draft.isCompensation}
      >
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Dokumentation
        </h3>
        <div>
          <label
            htmlFor={infoId}
            className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            <Icon name="eye" size={16} />
            Tätigkeit (Info für Geschäftsleitung)
            <span className="text-red-500">*</span>
          </label>
          <textarea
            id={infoId}
            className={field}
            rows={2}
            placeholder="Was die Geschäftsleitung erfahren darf"
            value={draft.infoForManagement}
            onChange={(e) => patch({ infoForManagement: e.target.value })}
            disabled={draft.isCompensation}
          />
        </div>

        <div className="confidential-block rounded-lg p-3">
          <label
            htmlFor={secretId}
            className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-confidential"
          >
            <Icon name="lock" size={16} />
            Vertrauliche Tätigkeitsbeschreibung
          </label>
          <textarea
            id={secretId}
            className="confidential-input"
            rows={3}
            placeholder="Genaue Tätigkeit (optional)"
            value={draft.secretDetails}
            onChange={(e) => patch({ secretDetails: e.target.value })}
            disabled={draft.isCompensation}
          />
          <p className="mt-1 text-xs text-confidential">
            Wird bei GL-Export ignoriert und in Listen nie im Klartext angezeigt.
          </p>
        </div>
      </div>

      {/* Block 3: Widersprüche der GL (einklappbar) */}
      <div className={blockCls}>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold text-slate-800 dark:text-slate-100"
          onClick={() => setObjOpen((v) => !v)}
        >
          <span className="flex items-center gap-1.5">
            <Icon name="alert-triangle" size={16} />
            Widersprüche der Geschäftsleitung
            {draft.objections.length > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900/40 dark:text-red-300">
                {draft.objections.length}
              </span>
            )}
          </span>
          <span className="text-slate-400">{objOpen ? "▴" : "▾"}</span>
        </button>
        {objOpen && (
          <ObjectionEditor
            objections={draft.objections}
            onChange={(objs) => patch({ objections: objs })}
          />
        )}
      </div>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {overlapWarning && (
        <div className="space-y-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <p>{overlapWarning}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-amber-300 px-3 py-1 text-xs hover:bg-white dark:border-amber-700 dark:hover:bg-amber-900/40"
              onClick={() => setOverlapWarning(null)}
            >
              Zeiten prüfen
            </button>
            <button
              type="button"
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              onClick={() => handleSave({ skipOverlapCheck: true })}
            >
              Trotzdem speichern
            </button>
          </div>
        </div>
      )}

      {/* Aktionsleiste */}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={secondaryBtnCls} onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button
          type="button"
          disabled={saving}
          className="rounded bg-sky-600 px-6 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          onClick={() => handleSave()}
          title="Strg/Cmd+Enter"
        >
          {saving ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
