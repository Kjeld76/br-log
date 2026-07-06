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
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="col-span-2 text-sm text-slate-800 dark:text-slate-200">
        {value}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {row("Datum", formatDateDe(entry.date))}
        {row(
          "Zeit",
          entry.startTime && entry.endTime
            ? `${entry.startTime} – ${entry.endTime}`
            : "—"
        )}
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
            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
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
        <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Widersprüche der Geschäftsleitung
        </h4>
        {entry.objections.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Keine.</p>
        ) : (
          <ul className="space-y-1">
            {entry.objections.map((o) => (
              <li
                key={o.id}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="text-slate-800 dark:text-slate-200">
                  {o.reason}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
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
          um), min-h-[48px] hebt die Tap-Höhe unter der sm-Grenze an. */}
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <button
          type="button"
          className="min-h-[48px] rounded px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 sm:min-h-0"
          onClick={onDelete}
        >
          Löschen
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryBtnCls + " min-h-[48px] sm:min-h-0"}
            onClick={onClose}
          >
            Schließen
          </button>
          <button
            type="button"
            className={secondaryBtnCls + " min-h-[48px] sm:min-h-0"}
            onClick={onDuplicate}
            title="Als Vorlage für heute übernehmen"
          >
            Duplizieren
          </button>
          <button
            type="button"
            className="min-h-[48px] rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 sm:min-h-0"
            onClick={onEdit}
          >
            Bearbeiten
          </button>
        </div>
      </div>
    </div>
  );
}
