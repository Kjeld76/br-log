import { useState } from "react";
import type { TimeEntry, TaskTag } from "../types";
import { saveEntry } from "../db/repository";
import { computeDuration, minutesToHhmm, formatDurationLong } from "../lib/time";
import ObjectionEditor from "./ObjectionEditor";

interface Props {
  entry: TimeEntry;
  tags: TaskTag[];
  onSaved: () => void;
  onCancel: () => void;
}

export default function EntryForm({ entry, tags, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<TimeEntry>(entry);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<TimeEntry>) => setDraft((d) => ({ ...d, ...p }));

  // Dauer ist IMMER aus Von/Bis abgeleitet (keine direkte Eingabe, kein Toggle).
  const duration = computeDuration(draft.startTime, draft.endTime);

  const toggleTag = (id: string) =>
    patch({
      tagIds: draft.tagIds.includes(id)
        ? draft.tagIds.filter((t) => t !== id)
        : [...draft.tagIds, id],
    });

  const handleSave = async () => {
    setError(null);
    if (!draft.date) {
      setError("Bitte ein Datum angeben.");
      return;
    }
    if (!draft.startTime || !draft.endTime) {
      setError("Bitte Von und Bis angeben.");
      return;
    }
    if (duration.error) {
      setError(duration.error);
      return;
    }
    if (duration.minutes === null || duration.minutes <= 0) {
      setError("Die Dauer muss größer als 0 sein.");
      return;
    }
    if (!draft.infoForManagement.trim()) {
      setError("Info für die Geschäftsleitung ist ein Pflichtfeld.");
      return;
    }
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

  return (
    <div className="space-y-4">
      {/* Datum + Zeit */}
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

      {/* Dauer – abgeleitet, readonly */}
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

      {/* Schlagwörter */}
      <div>
        <label className={labelCls}>Schlagwörter / Aufgaben</label>
        <div className="flex flex-wrap gap-1.5">
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
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                {t.label}
              </button>
            );
          })}
          {tags.length === 0 && (
            <span className="text-sm text-slate-500">
              Keine Schlagwörter – im Tab „Schlagwörter" anlegen.
            </span>
          )}
        </div>
      </div>

      {/* Info für GL – Pflichtfeld */}
      <div>
        <label className={labelCls}>
          Info für die Geschäftsleitung <span className="text-red-500">*</span>
        </label>
        <textarea
          className={field}
          rows={2}
          placeholder="Was die Geschäftsleitung erfahren darf (Pflichtfeld)"
          value={draft.infoForManagement}
          onChange={(e) => patch({ infoForManagement: e.target.value })}
        />
      </div>

      {/* Vertraulich – optional, kein Längenlimit */}
      <div className="confidential-block rounded p-3">
        <label className="mb-1 block text-sm font-semibold text-confidential-text">
          🔒 Vertraulich – genaue Tätigkeit (BR-Geheimnis, optional)
        </label>
        <textarea
          className="w-full rounded border border-red-200 bg-white p-2 text-sm"
          rows={3}
          placeholder="Genaue Tätigkeit – wird NIE in GL-Exporten oder Listen im Klartext gezeigt"
          value={draft.secretDetails}
          onChange={(e) => patch({ secretDetails: e.target.value })}
        />
      </div>

      {/* Schicht */}
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
              onChange={(e) => patch({ shiftCompensationNote: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* Widersprüche */}
      <div>
        <label className={labelCls}>Widerspruch der Geschäftsleitung</label>
        <ObjectionEditor
          objections={draft.objections}
          onChange={(objs) => patch({ objections: objs })}
        />
      </div>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          onClick={onCancel}
        >
          Abbrechen
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          onClick={handleSave}
        >
          {saving ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
