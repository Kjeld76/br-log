import type { AppointmentFullItem } from "../types";
import { formatDateDe } from "../lib/calendar";
import { reminderLabel, dotClsFor } from "../lib/appointmentUi";
import type { OccurrenceRef } from "../lib/appointments";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  appointment: AppointmentFullItem;
  occurrence: OccurrenceRef;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Öffnet das Eintragsformular vorbefüllt aus diesem Termin ("Zeit buchen"). */
  onBookTime: () => void;
}

export default function AppointmentDetail({
  appointment,
  occurrence,
  onEdit,
  onDelete,
  onDuplicate,
  onBookTime,
}: Props) {
  const a = appointment;
  // Label über Wert statt schmaler 1/3-Spalte (Design-Handoff #27, 1g) --
  // auf 360px-Breite lesbarer als das frühere 3-Spalten-Raster, dessen
  // Label-Spalte lange Begriffe ("Erinnerungen") abschnitt.
  const row = (label: string, value: React.ReactNode) => (
    <div className="py-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-secondary-ink">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-primary-ink">{value}</div>
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
  // Datum und Zeit in einer Zeile zusammengefasst (Design-Handoff #27, 1g)
  // statt zweier eigener Zeilen.
  const dateTimeValue = `${dateValue} · ${timeValue}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${dotClsFor(a.color)}`} />
        <h3 className="text-base font-semibold text-primary-ink">
          {a.title || "(ohne Titel)"}
        </h3>
        {a.isImportant && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning-badge px-1.5 py-0.5 text-xs font-medium text-warning-badge-ink"
            title="Als wichtig markiert"
          >
            <Icon name="alert-triangle" size={12} />
            Wichtig
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {row("Datum & Zeit", dateTimeValue)}
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
        <p className="confidential-blur whitespace-pre-wrap text-sm text-confidential">
          {a.secretDetails ? (
            a.secretDetails
          ) : (
            <span className="opacity-60">— nichts erfasst —</span>
          )}
        </p>
      </div>

      {/* Aktionsleiste (Design-Handoff #27, 1g): "Schließen" ist ins X im
          Modal-Header gewandert (App.tsx) -- die verbleibenden vier Aktionen
          brachen auf 360px sonst zu einem gedrängten Block um. Drei gleich
          große Icon-Buttons (Zeit buchen/Duplizieren/Löschen) bilden eine
          feste Reihe, "Bearbeiten" bleibt als einzige Primär-Aktion volle
          Breite in der Daumenzone. "Löschen" ist über text-destructive-ink
          weiterhin die einzige rote Aktion, nur nicht mehr direkt neben
          "Bearbeiten". */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex gap-2">
          <button
            type="button"
            className="flex min-h-touch-pointer flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border-strong px-2 py-2 text-xs text-primary-ink hover:bg-surface-2"
            onClick={onBookTime}
            title="Zeiteintrag mit Datum, Uhrzeit und Schlagwörtern dieses Termins anlegen"
          >
            <Icon name="clock" size={18} />
            Zeit buchen
          </button>
          <button
            type="button"
            className="flex min-h-touch-pointer flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border-strong px-2 py-2 text-xs text-primary-ink hover:bg-surface-2"
            onClick={onDuplicate}
            title="Als Vorlage für einen neuen Termin übernehmen"
          >
            <Icon name="copy" size={18} />
            Duplizieren
          </button>
          <button
            type="button"
            className="flex min-h-touch-pointer flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border-strong px-2 py-2 text-xs text-destructive-ink hover:bg-destructive-hover"
            onClick={onDelete}
          >
            <Icon name="trash" size={18} />
            Löschen
          </button>
        </div>
        <button
          type="button"
          className="min-h-touch w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          onClick={onEdit}
        >
          Bearbeiten
        </button>
      </div>
    </div>
  );
}
