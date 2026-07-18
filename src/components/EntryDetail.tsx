import type { EntryFullItem } from "../types";
import { formatDurationFull } from "../lib/time";
import { formatDateDe } from "../lib/calendar";
import { formatObjectionMeta } from "../lib/objections";
import { secondaryBtnCls } from "../lib/ui";
import TagChip from "./TagChip";
import { Icon } from "./Icon";

interface Props {
  entry: EntryFullItem;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onDuplicate: () => void;
}

export default function EntryDetail({
  entry,
  onEdit,
  onDelete,
  onClose,
  onDuplicate,
}: Props) {
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

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border">
        {row("Datum", formatDateDe(entry.date))}
        {row(
          "Zeit",
          entry.startTime && entry.endTime
            ? `${entry.startTime} – ${entry.endTime}`
            : "—"
        )}
        {entry.pauseMinutes > 0 && row("Pause", `${entry.pauseMinutes} Min`)}
        {row("Dauer", formatDurationFull(entry.durationMinutes))}
        {row(
          "Schlagwörter",
          entry.tagLabels.length ? (
            <div className="flex flex-wrap gap-1">
              {entry.tagLabels.map((l) => (
                <TagChip key={l} variant="readonly" label={l} />
              ))}
            </div>
          ) : (
            "—"
          )
        )}
        {row(
          "Freizeitausgleich",
          entry.isCompensation ? (
            <span className="inline-flex items-center gap-1 rounded bg-success-surface px-1.5 py-0.5 text-xs font-medium text-success-ink">
              genommen (§ 37 Abs. 3 BetrVG)
            </span>
          ) : (
            "nein"
          )
        )}
        {!entry.isCompensation && row("Info für GL", entry.infoForManagement || "—")}
        {!entry.isCompensation &&
          row("Geplante Schicht", entry.hadPlannedShift ? "ja" : "nein")}
        {!entry.isCompensation &&
          !entry.hadPlannedShift &&
          row("Schichtausgleich", entry.shiftCompensationNote || "—")}
      </div>

      {/* Widersprüche */}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-primary-ink">
          Widersprüche der Geschäftsleitung
        </h4>
        {entry.objections.length === 0 ? (
          <p className="text-sm text-secondary-ink">Keine.</p>
        ) : (
          <ul className="space-y-1">
            {entry.objections.map((o) => (
              <li
                key={o.id}
                className="rounded border border-border bg-surface-dim p-2 text-sm"
              >
                <div className="text-primary-ink">
                  {o.reason}
                </div>
                <div className="text-xs text-secondary-ink">
                  {formatObjectionMeta(o, " · ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Vertraulich – nur hier sichtbar. Bei Freizeitausgleich-Einträgen ohne
          erfasste vertrauliche Details ausgeblendet (keine BR-Tätigkeit,
          das Feld ist im Formular für diesen Fall gesperrt). */}
      {(!entry.isCompensation || entry.secretDetails) && (
        <div className="confidential-block rounded-lg p-3">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-confidential">
            <Icon name="lock" size={16} />
            Vertraulich – genaue Tätigkeit (BR-Geheimnis)
          </h4>
          <p className="whitespace-pre-wrap text-sm text-confidential">
            {entry.secretDetails ? (
              entry.secretDetails
            ) : (
              <span className="opacity-60">— nichts erfasst —</span>
            )}
          </p>
        </div>
      )}

      {/* Portrait-Feinschliff (Android): 4 Buttons in einer Zeile laufen bei
          360px Bildbreite über -- flex-wrap lässt die Aktionsgruppe sauber
          umbrechen (auf Desktop-Breiten reicht der Platz, es bricht dort nie
          um), min-h-touch hebt die Tap-Höhe unter der sm-Grenze an. */}
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
            title="Als Vorlage für heute übernehmen"
          >
            Duplizieren
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
