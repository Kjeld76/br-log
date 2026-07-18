import type { AppointmentFullItem } from "../types";
import { formatDateDe } from "../lib/calendar";
import { reminderLabel, dotClsFor } from "../lib/appointmentUi";
import { secondaryBtnCls } from "../lib/ui";
import type { OccurrenceRef } from "../lib/appointments";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  appointment: AppointmentFullItem;
  occurrence: OccurrenceRef;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onDuplicate: () => void;
  /** Öffnet das Eintragsformular vorbefüllt aus diesem Termin ("Zeit buchen"). */
  onBookTime: () => void;
}

export default function AppointmentDetail({
  appointment,
  occurrence,
  onEdit,
  onDelete,
  onClose,
  onDuplicate,
  onBookTime,
}: Props) {
  const a = appointment;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <div className="text-sm font-medium text-secondary-ink">
        {label}
      </div>
      <div className="col-span-2 text-sm text-primary-ink">
        {value}
      </div>
    </div>
  );

  // Datum/Zeit der ANGEZEIGTEN Instanz (bei Serien die konkrete Instanz,
  // bei Einzelterminen identisch mit den Terminfeldern).
  const multiDay = occurrence.startDate !== occurrence.endDate;
  const dateValue = multiDay
    ? `${formatDateDe(occurrence.startDate)} – ${formatDateDe(occurrence.endDate)}`
    : formatDateDe(occurrence.startDate);
  const timeValue = a.isAllDay
    ? "Ganztägig"
    : occurrence.startTime && occurrence.endTime
    ? `${occurrence.startTime} – ${occurrence.endTime}`
    : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${dotClsFor(a.color)}`} />
        <h3 className="text-base font-semibold text-primary-ink">
          {a.title || "(ohne Titel)"}
        </h3>
        {a.isImportant && (
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Als wichtig markiert"
          >
            <Icon name="alert-triangle" size={12} />
            Wichtig
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {row("Datum", dateValue)}
        {row("Zeit", timeValue)}
        {a.location && row("Ort", a.location)}
        {(a.rrule !== null || a.parentId !== null) &&
          row(
            "Serie",
            a.parentId !== null
              ? "Serientermin (diese Instanz wurde einzeln geändert)"
              : "Serientermin"
          )}
        {row(
          "Erinnerungen",
          a.reminders.length
            ? a.reminders.map((r) => reminderLabel(r.minutesBefore)).join(" · ")
            : "—"
        )}
        {row(
          "Schlagwörter",
          a.tagLabels.length ? (
            <div className="flex flex-wrap gap-1">
              {a.tagLabels.map((l) => (
                <TagChip key={l} variant="readonly" label={l} />
              ))}
            </div>
          ) : (
            "—"
          )
        )}
        {a.description && row("Beschreibung", <span className="whitespace-pre-wrap">{a.description}</span>)}
      </div>

      {/* Vertraulich – nur in dieser Detailansicht sichtbar. */}
      <div className="confidential-block rounded-lg p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-confidential">
          <Icon name="lock" size={16} />
          Vertrauliche Notizen (BR-Geheimnis)
        </h4>
        <p className="whitespace-pre-wrap text-sm text-confidential">
          {a.secretDetails ? (
            a.secretDetails
          ) : (
            <span className="opacity-60">— nichts erfasst —</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          className="min-h-touch rounded px-3 py-2 text-sm text-destructive-ink hover:bg-destructive-hover sm:min-h-0"
          onClick={onDelete}
        >
          Löschen
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryBtnCls + " min-h-touch sm:min-h-0"}
            onClick={onClose}
          >
            Schließen
          </button>
          <button
            type="button"
            className={secondaryBtnCls + " min-h-touch sm:min-h-0"}
            onClick={onDuplicate}
            title="Als Vorlage für einen neuen Termin übernehmen"
          >
            Duplizieren
          </button>
          <button
            type="button"
            className={secondaryBtnCls + " min-h-touch sm:min-h-0"}
            onClick={onBookTime}
            title="Zeiteintrag mit Datum, Uhrzeit und Schlagwörtern dieses Termins anlegen"
          >
            Zeit buchen
          </button>
          <button
            type="button"
            className="min-h-touch rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover sm:min-h-0"
            onClick={onEdit}
          >
            Bearbeiten
          </button>
        </div>
      </div>
    </div>
  );
}
