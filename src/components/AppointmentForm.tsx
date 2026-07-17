import { useEffect, useId, useRef, useState } from "react";
import type { Appointment, TaskTag } from "../types";
import { newReminder, saveAppointment } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { toggleId } from "../lib/collections";
import { inputCls, secondaryBtnCls } from "../lib/ui";
import {
  COLOR_OPTIONS,
  REMINDER_PRESETS,
  reminderLabel,
} from "../lib/appointmentUi";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  appointment: Appointment;
  tags: TaskTag[];
  onSaved: () => void;
  onCancel?: () => void;
  // Meldet jede Änderung am Entwurf + Dirty-Zustand (Muster EntryForm: trägt
  // die Dirty-Rückfrage von Backdrop/Escape in App.tsx).
  onDraftChange?: (draft: Appointment, dirty: boolean) => void;
  // Externe Ref auf das Titelfeld für die Fokusfalle des Modals (Finding B5).
  titleInputRef?: React.RefObject<HTMLInputElement>;
}

export default function AppointmentForm({
  appointment,
  tags,
  onSaved,
  onCancel,
  onDraftChange,
  titleInputRef: externalTitleInputRef,
}: Props) {
  const [draft, setDraft] = useState<Appointment>(appointment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const ownTitleInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = externalTitleInputRef ?? ownTitleInputRef;

  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const locationId = `${idPrefix}-location`;
  const startDateId = `${idPrefix}-start-date`;
  const startTimeId = `${idPrefix}-start-time`;
  const endDateId = `${idPrefix}-end-date`;
  const endTimeId = `${idPrefix}-end-time`;
  const descriptionId = `${idPrefix}-description`;
  const secretId = `${idPrefix}-secret`;

  const baselineRef = useRef(JSON.stringify(appointment));

  useEffect(() => {
    titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<Appointment>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    const dirty = JSON.stringify(draft) !== baselineRef.current;
    onDraftChange?.(draft, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const toggleTag = (id: string) => patch({ tagIds: toggleId(draft.tagIds, id) });
  const assignedTags = tags.filter((t) => draft.tagIds.includes(t.id));
  const pickableTags = tags.filter((t) => !t.archived);

  const toggleAllDay = (allDay: boolean) => {
    if (allDay) {
      patch({ isAllDay: true, startTime: null, endTime: null });
    } else {
      patch({ isAllDay: false, startTime: "09:00", endTime: "10:00" });
    }
  };

  // Startdatum-Änderung zieht ein davor liegendes Enddatum mit -- ein Termin,
  // der vor seinem Beginn endet, ist nie gewollt (DB lehnt ihn ohnehin ab).
  const setStartDate = (v: string) => {
    patch({ startDate: v, endDate: draft.endDate < v ? v : draft.endDate });
  };

  const toggleReminderPreset = (minutes: number) => {
    const existing = draft.reminders.find((r) => r.minutesBefore === minutes);
    if (existing) {
      patch({ reminders: draft.reminders.filter((r) => r.id !== existing.id) });
    } else {
      // Stabile UUID je Erinnerung (siehe types.ts: reminder_fired hängt daran).
      patch({
        reminders: [...draft.reminders, newReminder(minutes)].sort(
          (a, b) => a.minutesBefore - b.minutesBefore
        ),
      });
    }
  };

  const handleSave = async () => {
    setError(null);
    if (!draft.title.trim()) return setError("Bitte einen Titel angeben.");
    if (!draft.startDate) return setError("Bitte ein Startdatum angeben.");
    if (!draft.endDate) return setError("Bitte ein Enddatum angeben.");
    if (draft.endDate < draft.startDate)
      return setError("Das Ende darf nicht vor dem Beginn liegen.");
    if (!draft.isAllDay) {
      if (!draft.startTime || !draft.endTime)
        return setError("Bitte Beginn- und Endzeit angeben (oder Ganztägig wählen).");
      if (draft.startDate === draft.endDate && draft.endTime <= draft.startTime)
        return setError("Die Endzeit muss nach der Beginnzeit liegen.");
    }

    setSaving(true);
    try {
      await saveAppointment({ ...draft, title: draft.title.trim() });
      onSaved();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Tastaturkürzel wie EntryForm: Strg/Cmd+Enter speichert, Escape bricht ab.
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
  }, [draft, saving, onCancel]);

  const field = inputCls + " w-full";
  const labelCls =
    "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";
  const blockCls =
    "space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800";

  return (
    <div className="space-y-4">
      {/* Block 1: Termin */}
      <div className={blockCls}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Termin
        </h3>
        <div>
          <label htmlFor={titleId} className={labelCls}>
            Titel <span className="text-red-500">*</span>
          </label>
          <input
            id={titleId}
            ref={titleInputRef}
            type="text"
            className={field}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="z. B. BR-Sitzung"
          />
        </div>
        <div>
          <label htmlFor={locationId} className={labelCls}>
            Ort
          </label>
          <input
            id={locationId}
            type="text"
            className={field}
            value={draft.location}
            onChange={(e) => patch({ location: e.target.value })}
            placeholder="z. B. Besprechungsraum 2"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.isAllDay}
            onChange={(e) => toggleAllDay(e.target.checked)}
          />
          Ganztägig
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className={draft.isAllDay ? "sm:col-span-2" : ""}>
            <label htmlFor={startDateId} className={labelCls}>
              Beginn <span className="text-red-500">*</span>
            </label>
            <input
              id={startDateId}
              type="date"
              className={field}
              value={draft.startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          {!draft.isAllDay && (
            <div>
              <label htmlFor={startTimeId} className={labelCls}>
                Uhrzeit
              </label>
              <input
                id={startTimeId}
                type="time"
                className={field}
                value={draft.startTime ?? ""}
                onChange={(e) => patch({ startTime: e.target.value || null })}
              />
            </div>
          )}
          <div className={draft.isAllDay ? "sm:col-span-2" : ""}>
            <label htmlFor={endDateId} className={labelCls}>
              Ende <span className="text-red-500">*</span>
            </label>
            <input
              id={endDateId}
              type="date"
              className={field}
              value={draft.endDate}
              min={draft.startDate}
              onChange={(e) => patch({ endDate: e.target.value })}
            />
          </div>
          {!draft.isAllDay && (
            <div>
              <label htmlFor={endTimeId} className={labelCls}>
                Uhrzeit
              </label>
              <input
                id={endTimeId}
                type="time"
                className={field}
                value={draft.endTime ?? ""}
                onChange={(e) => patch({ endTime: e.target.value || null })}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.isImportant}
              onChange={(e) => patch({ isImportant: e.target.checked })}
            />
            <span className="flex items-center gap-1">
              <Icon name="alert-triangle" size={14} />
              Wichtig
            </span>
          </label>
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Farbe">
            {COLOR_OPTIONS.map((c) => {
              const active = draft.color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Farbe ${c.label}`}
                  title={c.label}
                  onClick={() => patch({ color: active ? null : c.value })}
                  className={
                    `h-6 w-6 rounded-full ${c.dotCls} transition ` +
                    (active
                      ? "ring-2 ring-slate-700 ring-offset-1 dark:ring-slate-200"
                      : "opacity-60 hover:opacity-100")
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Block 2: Erinnerungen */}
      <div className={blockCls}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Erinnerungen
        </h3>
        <div className="flex flex-wrap gap-2">
          {REMINDER_PRESETS.map((p) => (
            <TagChip
              key={p.minutes}
              label={p.label}
              variant="selectable"
              active={draft.reminders.some((r) => r.minutesBefore === p.minutes)}
              onClick={() => toggleReminderPreset(p.minutes)}
            />
          ))}
        </div>
        {draft.reminders.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {draft.reminders
              .map((r) => reminderLabel(r.minutesBefore))
              .join(" · ")}
          </p>
        )}
      </div>

      {/* Block 3: Schlagwörter (dieselben wie bei Zeiteinträgen -- Vorbefüllung
          bei "Zeit buchen") */}
      <div className={blockCls}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Schlagwörter
          </h3>
          <button
            type="button"
            className="text-sm text-sky-700 hover:underline dark:text-sky-400"
            onClick={() => setTagPickerOpen((o) => !o)}
          >
            {tagPickerOpen ? "Fertig" : "Auswählen"}
          </button>
        </div>
        {assignedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {assignedTags.map((t) => (
              <TagChip
                key={t.id}
                label={t.label}
                variant="removable"
                archived={t.archived}
                onClick={() => toggleTag(t.id)}
              />
            ))}
          </div>
        )}
        {tagPickerOpen && (
          <div className="flex flex-wrap gap-1.5">
            {pickableTags.map((t) => (
              <TagChip
                key={t.id}
                label={t.label}
                variant="selectable"
                active={draft.tagIds.includes(t.id)}
                onClick={() => toggleTag(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Block 4: Beschreibung + vertrauliche Notizen */}
      <div className={blockCls}>
        <div>
          <label htmlFor={descriptionId} className={labelCls}>
            Beschreibung
          </label>
          <textarea
            id={descriptionId}
            className={field}
            rows={3}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Öffentliche Angaben zum Termin"
          />
        </div>
        <div className="confidential-block rounded-lg p-3">
          <label
            htmlFor={secretId}
            className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-confidential"
          >
            <Icon name="eye" size={14} />
            Vertrauliche Notizen (BR-Geheimnis)
          </label>
          <textarea
            id={secretId}
            className="confidential-input"
            rows={3}
            value={draft.secretDetails}
            onChange={(e) => patch({ secretDetails: e.target.value })}
            placeholder="Nur hier: vertrauliche Angaben zum Termin"
          />
          <p className="mt-1 text-xs text-confidential">
            Erscheint nie in Kalender-/Listenansichten und standardmäßig nicht im
            ICS-Export.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={secondaryBtnCls} onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button
          type="button"
          className="rounded bg-sky-600 px-6 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
