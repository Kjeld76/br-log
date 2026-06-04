import { useState } from "react";
import type { TimeEntry, TaskTag } from "../types";
import { saveEntry } from "../db/repository";
import { computeDuration, minutesToHhmm, formatDurationLong } from "../lib/time";
import ObjectionEditor from "./ObjectionEditor";
import { Icon } from "./Icon";

interface Props {
  entry: TimeEntry;
  tags: TaskTag[];
  onSaved: () => void;
  onCancel?: () => void; // optional: im Seiten-Modus (Startseite) ausgeblendet
}

export default function EntryForm({ entry, tags, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<TimeEntry>(entry);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [objOpen, setObjOpen] = useState(entry.objections.length > 0);

  const patch = (p: Partial<TimeEntry>) => setDraft((d) => ({ ...d, ...p }));

  // Dauer ist IMMER aus Von/Bis abgeleitet (kein Toggle, kein direktes Eingeben).
  const duration = computeDuration(draft.startTime, draft.endTime);

  const toggleTag = (id: string) =>
    patch({
      tagIds: draft.tagIds.includes(id)
        ? draft.tagIds.filter((t) => t !== id)
        : [...draft.tagIds, id],
    });

  const selectedTags = tags.filter((t) => draft.tagIds.includes(t.id));

  const handleSave = async () => {
    setError(null);
    if (!draft.date) return setError("Bitte ein Datum angeben.");
    if (!draft.startTime || !draft.endTime)
      return setError("Bitte Von und Bis angeben.");
    if (duration.error) return setError(duration.error);
    if (duration.minutes === null || duration.minutes <= 0)
      return setError("Die Dauer muss größer als 0 sein.");
    if (!draft.infoForManagement.trim())
      return setError("Info für die Geschäftsleitung ist ein Pflichtfeld.");

    setSaving(true);
    try {
      await saveEntry({ ...draft, durationMinutes: duration.minutes });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded border border-slate-300 p-2 text-sm";
  const labelCls = "block text-sm font-medium text-slate-700 mb-1";
  const blockCls = "rounded-lg border border-slate-200 bg-white p-4 space-y-3";

  return (
    <div className="space-y-4">
      {/* Block 1: Zeit & Art */}
      <div className={blockCls}>
        <h3 className="text-sm font-semibold text-slate-800">Zeit &amp; Art</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>
              Datum <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className={field}
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>
              Von <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              className={field}
              value={draft.startTime ?? ""}
              onChange={(e) => patch({ startTime: e.target.value || null })}
            />
          </div>
          <div>
            <label className={labelCls}>
              Bis <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              className={field}
              value={draft.endTime ?? ""}
              onChange={(e) => patch({ endTime: e.target.value || null })}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Dauer (automatisch berechnet)</label>
          <div
            className={
              "rounded border p-2 text-sm " +
              (duration.error
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-700")
            }
          >
            {duration.error
              ? duration.error
              : duration.minutes !== null
              ? `${minutesToHhmm(duration.minutes)} Std (${formatDurationLong(
                  duration.minutes
                )})`
              : "— wird aus Von/Bis berechnet —"}
          </div>
        </div>

        {/* Schlagwörter: Dropdown + sichtbare Chips */}
        <div>
          <label className={labelCls}>Schlagwörter / Aufgaben</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-xs text-white"
              >
                {t.label}
                <button
                  type="button"
                  className="text-white/80 hover:text-white"
                  onClick={() => toggleTag(t.id)}
                  aria-label="Entfernen"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setTagPickerOpen((v) => !v)}
            >
              {tagPickerOpen ? "Fertig ▴" : "+ Schlagwort ▾"}
            </button>
          </div>
          {tagPickerOpen && (
            <div className="mt-2 flex flex-wrap gap-1.5 rounded border border-slate-200 bg-slate-50 p-2">
              {tags.length === 0 && (
                <span className="text-xs text-slate-500">
                  Keine Schlagwörter – unter „Über / Daten" anlegen.
                </span>
              )}
              {tags.map((t) => {
                const active = draft.tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={
                      "rounded-full border px-3 py-1 text-xs " +
                      (active
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100")
                    }
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Geplante Schicht */}
        <div className="rounded border border-slate-200 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.hadPlannedShift}
              onChange={(e) => patch({ hadPlannedShift: e.target.checked })}
            />
            Geplante Schicht zu dieser Zeit
          </label>
          {!draft.hadPlannedShift && (
            <div>
              <label className={labelCls}>
                Schichtausgleich (z. B. andere Schicht streichen lassen / getauscht)
              </label>
              <textarea
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
      </div>

      {/* Block 2: Dokumentation */}
      <div className={blockCls}>
        <h3 className="text-sm font-semibold text-slate-800">Dokumentation</h3>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Icon name="eye" size={16} />
            Tätigkeit (Info für Geschäftsleitung)
            <span className="text-red-500">*</span>
          </label>
          <textarea
            className={field}
            rows={2}
            placeholder="Was die Geschäftsleitung erfahren darf"
            value={draft.infoForManagement}
            onChange={(e) => patch({ infoForManagement: e.target.value })}
          />
        </div>

        <div className="confidential-block rounded-lg p-3">
          <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-confidential-text">
            <Icon name="lock" size={16} />
            Vertrauliche Tätigkeitsbeschreibung
          </label>
          <textarea
            className="w-full rounded border border-red-200 bg-white p-2 text-sm"
            rows={3}
            placeholder="Genaue Tätigkeit (optional)"
            value={draft.secretDetails}
            onChange={(e) => patch({ secretDetails: e.target.value })}
          />
          <p className="mt-1 text-xs text-confidential-text">
            Wird bei GL-Export ignoriert und in Listen nie im Klartext angezeigt.
          </p>
        </div>
      </div>

      {/* Block 3: Widersprüche der GL (einklappbar) */}
      <div className={blockCls}>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold text-slate-800"
          onClick={() => setObjOpen((v) => !v)}
        >
          <span className="flex items-center gap-1.5">
            <Icon name="alert-triangle" size={16} />
            Widersprüche der Geschäftsleitung
            {draft.objections.length > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
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
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Aktionsleiste */}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            onClick={onCancel}
          >
            Abbrechen
          </button>
        )}
        <button
          type="button"
          disabled={saving}
          className="rounded bg-sky-600 px-6 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          onClick={handleSave}
        >
          {saving ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
