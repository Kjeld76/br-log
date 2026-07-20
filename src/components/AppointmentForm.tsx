import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Appointment, TaskTag } from "../types";
import { newReminder, saveAppointment } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { useSaveShortcuts } from "../lib/useSaveShortcuts";
import { toggleId } from "../lib/collections";
import {
  errorBoxCls,
  formBlockCls,
  inputCls,
  labelCls,
  secondaryBtnCls,
} from "../lib/ui";
import {
  buildRrule,
  parseRruleToPreset,
  WEEKDAY_CODES,
  type SeriesPreset,
  type WeekdayCode,
} from "../lib/appointments";
import {
  COLOR_OPTIONS,
  REMINDER_PRESETS,
  reminderLabel,
} from "../lib/appointmentUi";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mo",
  TU: "Di",
  WE: "Mi",
  TH: "Do",
  FR: "Fr",
  SA: "Sa",
  SU: "So",
};

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
  /**
   * Ersetzt das Standard-Speichern (saveAppointment) -- der "diesen und
   * folgende"-Split übergibt hier splitSeries mit dem gekürzten alten Master.
   */
  saveAction?: (appt: Appointment) => Promise<void>;
  /** Hinweistext oberhalb des Formulars (z. B. Split-/Override-Kontext). */
  contextHint?: string;
}

export default function AppointmentForm({
  appointment,
  tags,
  onSaved,
  onCancel,
  onDraftChange,
  titleInputRef: externalTitleInputRef,
  saveAction,
  contextHint,
}: Props) {
  const [draft, setDraft] = useState<Appointment>(appointment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  // Beschreibung/vertrauliche Notizen als aufklappbarer Abschnitt (Design-
  // Handoff #27, 1h) -- Ausgangszustand aus dem ÜBERGEBENEN Termin (nicht aus
  // dem live editierten draft): ein bereits ausgefüllter Text war vorher
  // immer sichtbar und darf durch den neuen Abschnitt nicht versehentlich
  // verschwinden, ein leeres Formular startet dagegen eingeklappt (Muster
  // wie objOpen in EntryForm für die Widersprüche).
  const [notesOpen, setNotesOpen] = useState(
    () => appointment.description.trim() !== "" || appointment.secretDetails.trim() !== ""
  );
  // Aus draft.rrule ABGELEITET statt als eigener State: die Regel ist damit
  // wirklich die einzige Quelle der Wahrheit und kein Codepfad kann die
  // Serien-UI desynchronisieren. Nicht abbildbare (importierte) Regeln
  // liefern null und laufen als "custom" unverändert durch das Formular.
  const seriesPreset = useMemo(
    () => (draft.rrule ? parseRruleToPreset(draft.rrule) : null),
    [draft.rrule]
  );
  const isCustomRule = draft.rrule !== null && seriesPreset === null;
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
  // Panel-Id des Beschreibungs-/Notizen-Disclosures (Finding #27-Review):
  // aria-controls/-expanded gehören zusammen, EntryList macht es beim
  // Zeitraum-Filter (rangePanelId) vor.
  const notesPanelId = `${idPrefix}-notes-panel`;

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

  const applyPreset = (p: SeriesPreset | null) => {
    patch({ rrule: p ? buildRrule(p) : null });
  };
  const setFreq = (freq: "" | SeriesPreset["freq"]) => {
    if (freq === "") {
      applyPreset(null);
      return;
    }
    applyPreset({
      freq,
      interval: seriesPreset?.interval ?? 1,
      byWeekdays: freq === "WEEKLY" ? seriesPreset?.byWeekdays ?? [] : [],
      end: seriesPreset?.end ?? { type: "never" },
    });
  };
  const patchPreset = (p: Partial<SeriesPreset>) => {
    if (!seriesPreset) return;
    applyPreset({ ...seriesPreset, ...p });
  };
  const toggleWeekday = (code: WeekdayCode) => {
    if (!seriesPreset) return;
    const has = seriesPreset.byWeekdays.includes(code);
    patchPreset({
      byWeekdays: has
        ? seriesPreset.byWeekdays.filter((c) => c !== code)
        : [...seriesPreset.byWeekdays, code],
    });
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
    if (seriesPreset) {
      if (
        seriesPreset.end.type === "count" &&
        (!Number.isInteger(seriesPreset.end.count) || seriesPreset.end.count < 1)
      ) {
        return setError("Bitte eine gültige Anzahl an Terminen angeben.");
      }
      if (
        seriesPreset.end.type === "until" &&
        (!seriesPreset.end.date || seriesPreset.end.date < draft.startDate)
      ) {
        return setError("Das Serienende darf nicht vor dem ersten Termin liegen.");
      }
    }

    setSaving(true);
    try {
      const save = saveAction ?? saveAppointment;
      await save({ ...draft, title: draft.title.trim() });
      onSaved();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Tastaturkürzel wie EntryForm: Strg/Cmd+Enter speichert, Escape bricht ab.
  useSaveShortcuts({ save: () => void handleSave(), cancel: onCancel, saving });

  const field = inputCls + " w-full";
  // Live (nicht nur beim Öffnen) geprüft, damit der Hinweis-Chip verschwindet/
  // erscheint, sobald während der Bearbeitung Text hinzukommt oder gelöscht
  // wird -- analog zur Widerspruchs-Anzahl in EntryForm.
  const hasNotesContent =
    draft.description.trim() !== "" || draft.secretDetails.trim() !== "";

  return (
    <div className="space-y-4">
      {contextHint && (
        <p className="rounded-lg border border-info-banner-line bg-info-banner p-3 text-sm text-info-banner-ink">
          {contextHint}
        </p>
      )}

      {/* Block 1: Termin */}
      <div className={formBlockCls}>
        <h3 className="text-sm font-semibold text-primary-ink">
          Termin
        </h3>
        <div>
          <label htmlFor={titleId} className={labelCls}>
            Titel <span className="text-required">*</span>
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
        {/* Ganztägig/Wichtig als antippbare Chips statt zweier Kästchen
            (Design-Handoff #27, 1h; Muster TagChip variant="selectable" wie
            in EntryForm). */}
        <div className="flex flex-wrap gap-1.5">
          <TagChip
            variant="selectable"
            label="Ganztägig"
            active={draft.isAllDay}
            onClick={() => toggleAllDay(!draft.isAllDay)}
          />
          <TagChip
            variant="selectable"
            label="Wichtig"
            active={draft.isImportant}
            onClick={() => patch({ isImportant: !draft.isImportant })}
          />
        </div>
        {/* Datum/Uhrzeit paarweise in zwei Spalten (Beginn/Ende) statt vier
            gestapelter Felder (Design-Handoff #27, 1h) -- auch auf Mobil
            (kein sm:-Umbruch), analog zur Von/Bis-Paarung in EntryForm. */}
        <div className="grid grid-cols-2 gap-3">
          <div className={draft.isAllDay ? "col-span-2" : ""}>
            <label htmlFor={startDateId} className={labelCls}>
              Beginn <span className="text-required">*</span>
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
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={draft.isAllDay ? "col-span-2" : ""}>
            <label htmlFor={endDateId} className={labelCls}>
              Ende <span className="text-required">*</span>
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
        <div>
          <span className={labelCls}>Farbe</span>
          {/* Farbwahl-Punkte 24 -> 34px (Design-Handoff #27, 1h; zuvor unter
              der Touch-Grenze). Auswahlring bleibt Fokus-/Auswahl-Merkmal,
              ring-offset auf 2 angehoben, damit er beim größeren Punkt
              weiterhin klar sichtbar absteht. */}
          <div className="flex items-center gap-3" role="radiogroup" aria-label="Farbe">
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
                    `h-[34px] w-[34px] rounded-full ${c.dotCls} transition ` +
                    (active
                      ? "ring-2 ring-primary-ink ring-offset-2"
                      : "opacity-60 hover:opacity-100")
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Block 2: Serie -- nicht für Overrides (die Einzeländerung einer
          Instanz hat nie eine eigene Regel, siehe Migration-3-CHECK). */}
      {draft.parentId === null && (
        <div className={formBlockCls}>
          <h3 className="text-sm font-semibold text-primary-ink">
            Wiederholung
          </h3>
          {isCustomRule ? (
            <div className="space-y-2">
              <p className="text-sm text-secondary-ink">
                Benutzerdefinierte Serienregel (z. B. aus einem ICS-Import) –
                bleibt beim Speichern unverändert erhalten.
              </p>
              <code className="block break-all rounded bg-code-surface p-2 text-xs text-secondary-ink">
                {draft.rrule}
              </code>
              <button
                type="button"
                className="text-sm text-destructive-ink hover:underline"
                onClick={() => applyPreset(null)}
              >
                Wiederholung entfernen
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${idPrefix}-freq`} className={labelCls}>
                    Wiederholt sich
                  </label>
                  <select
                    id={`${idPrefix}-freq`}
                    className={field}
                    value={seriesPreset?.freq ?? ""}
                    onChange={(e) =>
                      setFreq(e.target.value as "" | SeriesPreset["freq"])
                    }
                  >
                    <option value="">Nie</option>
                    <option value="DAILY">Täglich</option>
                    <option value="WEEKLY">Wöchentlich</option>
                    <option value="MONTHLY">Monatlich</option>
                    <option value="YEARLY">Jährlich</option>
                  </select>
                </div>
                {seriesPreset && (
                  <div>
                    <label htmlFor={`${idPrefix}-interval`} className={labelCls}>
                      Alle
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`${idPrefix}-interval`}
                        type="number"
                        min={1}
                        className={inputCls + " w-20"}
                        value={seriesPreset.interval}
                        onChange={(e) =>
                          patchPreset({
                            interval: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          })
                        }
                      />
                      <span className="text-sm text-secondary-ink">
                        {seriesPreset.freq === "DAILY" && "Tage"}
                        {seriesPreset.freq === "WEEKLY" && "Wochen"}
                        {seriesPreset.freq === "MONTHLY" && "Monate"}
                        {seriesPreset.freq === "YEARLY" && "Jahre"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {seriesPreset?.freq === "WEEKLY" && (
                <div>
                  <span className={labelCls}>An diesen Wochentagen</span>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_CODES.map((code) => (
                      <TagChip
                        key={code}
                        label={WEEKDAY_LABELS[code]}
                        variant="selectable"
                        active={seriesPreset.byWeekdays.includes(code)}
                        onClick={() => toggleWeekday(code)}
                      />
                    ))}
                  </div>
                  {seriesPreset.byWeekdays.length === 0 && (
                    <p className="mt-1 text-xs text-secondary-ink">
                      Ohne Auswahl gilt der Wochentag des ersten Termins.
                    </p>
                  )}
                </div>
              )}

              {seriesPreset && (
                <div className="space-y-2">
                  <span className={labelCls}>Ende der Serie</span>
                  <div className="flex flex-col gap-2 text-sm text-primary-ink">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${idPrefix}-series-end`}
                        checked={seriesPreset.end.type === "never"}
                        onChange={() => patchPreset({ end: { type: "never" } })}
                      />
                      Nie
                    </label>
                    <label className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name={`${idPrefix}-series-end`}
                        checked={seriesPreset.end.type === "count"}
                        onChange={() =>
                          patchPreset({ end: { type: "count", count: 10 } })
                        }
                      />
                      Nach
                      <input
                        type="number"
                        min={1}
                        className={inputCls + " w-20 py-1"}
                        disabled={seriesPreset.end.type !== "count"}
                        value={
                          seriesPreset.end.type === "count"
                            ? seriesPreset.end.count
                            : 10
                        }
                        onChange={(e) =>
                          patchPreset({
                            end: {
                              type: "count",
                              count: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            },
                          })
                        }
                      />
                      Terminen
                    </label>
                    <label className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name={`${idPrefix}-series-end`}
                        checked={seriesPreset.end.type === "until"}
                        onChange={() =>
                          patchPreset({
                            end: { type: "until", date: draft.startDate },
                          })
                        }
                      />
                      Am
                      <input
                        type="date"
                        className={inputCls + " py-1"}
                        disabled={seriesPreset.end.type !== "until"}
                        min={draft.startDate}
                        value={
                          seriesPreset.end.type === "until"
                            ? seriesPreset.end.date
                            : draft.startDate
                        }
                        onChange={(e) =>
                          patchPreset({
                            end: { type: "until", date: e.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Blöcke 3+4 (Erinnerungen, Schlagwörter) gelten je Serie und nicht je
          Einzeländerung -- Overrides erben sie vom Master (siehe Migration 3)
          und zeigen die Blöcke deshalb gar nicht erst an. */}
      {draft.parentId === null && (
      <div className={formBlockCls}>
        <h3 className="text-sm font-semibold text-primary-ink">
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
          <p className="text-xs text-secondary-ink">
            {draft.reminders
              .map((r) => reminderLabel(r.minutesBefore))
              .join(" · ")}
          </p>
        )}
      </div>
      )}

      {/* Block 4: Schlagwörter (dieselben wie bei Zeiteinträgen -- Vorbefüllung
          bei "Zeit buchen") */}
      {draft.parentId === null && (
      <div className={formBlockCls}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-primary-ink">
            Schlagwörter
          </h3>
          <button
            type="button"
            className="text-sm text-link hover:underline"
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
      )}

      {/* Block 5: Beschreibung + vertrauliche Notizen -- als aufklappbarer
          Abschnitt (Design-Handoff #27, 1h; Muster wie "Widersprüche" in
          EntryForm), da selten genutzt. KRITISCH: Das Vertraulich-Feld bleibt
          inhaltlich unverändert (gleiche confidential-block/-input-
          Kennzeichnung, gleicher Hinweistext) und wird durch das Zuklappen
          nicht neu preisgegeben -- notesOpen startet oben bereits offen,
          wenn Text vorhanden war. Ist der Abschnitt (wieder) zugeklappt,
          zeigt ein neutraler Hinweis-Chip nur AN, dass etwas erfasst ist,
          ohne den Inhalt selbst zu zeigen -- sonst ginge die Information
          "hier steht schon was" verloren. */}
      <div className={formBlockCls}>
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold text-primary-ink"
          onClick={() => setNotesOpen((v) => !v)}
          aria-expanded={notesOpen}
          aria-controls={notesPanelId}
        >
          <span className="flex items-center gap-1.5">
            Beschreibung &amp; vertrauliche Notizen
            {hasNotesContent && (
              <span className="rounded-full bg-info-badge px-2 py-0.5 text-xs text-info-ink">
                Angaben vorhanden
              </span>
            )}
          </span>
          <span className="text-disabled-ink">{notesOpen ? "▴" : "▾"}</span>
        </button>
        {notesOpen && (
          <div id={notesPanelId} className="space-y-3 pt-3">
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
                Erscheint nie in Kalender-/Listenansichten und standardmäßig
                nicht im ICS-Export.
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className={errorBoxCls}>
          {error}
        </p>
      )}

      {/* Fixierte Aktionsleiste (Design-Handoff #27, 1h), Muster 1:1 aus
          EntryForm übernommen: "Speichern" bleibt beim Scrollen in der
          Daumenzone sichtbar. -mx-4 gleicht das p-4 der Modal-Box in App.tsx
          aus, damit die Leiste randlos über die volle Breite reicht;
          bg-surface + border-t verhindern, dass darunterscrollender Inhalt
          durchscheint. AppointmentForm läuft anders als EntryForm AUSSCHLIESS-
          LICH im Modal (App.tsx) -- `sticky bottom-0` pinnt hier immer an der
          unteren Kante des `fixed inset-0 overflow-y-auto`-Backdrops, der
          ohnehin den kompletten Viewport inkl. BottomNav überdeckt
          (`z-overlay` liegt über jeder Nav-Ebene); ein Kollisionsfall wie beim
          direkt in `main` eingebetteten EntryForm (s. dortiger Kommentar für
          die volle Begründung des früheren Fehlers) existiert hier also gar
          nicht. Portrait-Feinschliff bleibt erhalten: unter der sm-Grenze
          füllen die Buttons die volle Breite (flex-1) mit 48px Tap-Höhe, ab
          sm rechtsbündig kompakt. */}
      <div className="sticky bottom-0 z-sticky -mx-4 flex justify-end gap-2 border-t border-border bg-surface px-4 py-3">
        {onCancel && (
          <button
            type="button"
            className={secondaryBtnCls + " min-h-touch flex-1 sm:min-h-0 sm:flex-none"}
            onClick={onCancel}
          >
            Abbrechen
          </button>
        )}
        <button
          type="button"
          className="min-h-touch flex-1 rounded bg-primary px-6 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50 sm:min-h-0 sm:flex-none"
          onClick={() => void handleSave()}
          disabled={saving}
          title="Strg/Cmd+Enter"
        >
          {saving ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
