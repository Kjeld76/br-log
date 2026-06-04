import type { EntryListItem } from "../types";
import { minutesToHhmm, formatDurationLong } from "../lib/time";
import { Icon } from "./Icon";

interface Props {
  entry: EntryListItem;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function EntryDetail({ entry, onEdit, onDelete, onClose }: Props) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="col-span-2 text-sm text-slate-800">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="divide-y divide-slate-100">
        {row("Datum", entry.date)}
        {row(
          "Zeit",
          entry.startTime && entry.endTime
            ? `${entry.startTime} – ${entry.endTime}`
            : "—"
        )}
        {row(
          "Dauer",
          `${minutesToHhmm(entry.durationMinutes)} Std (${formatDurationLong(
            entry.durationMinutes
          )})`
        )}
        {row(
          "Schlagwörter",
          entry.tagLabels.length ? (
            <div className="flex flex-wrap gap-1">
              {entry.tagLabels.map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  {l}
                </span>
              ))}
            </div>
          ) : (
            "—"
          )
        )}
        {row("Info für GL", entry.infoForManagement || "—")}
        {row(
          "Geplante Schicht",
          entry.hadPlannedShift ? "ja" : "nein"
        )}
        {!entry.hadPlannedShift &&
          row("Schichtausgleich", entry.shiftCompensationNote || "—")}
      </div>

      {/* Widersprüche */}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-700">
          Widersprüche der Geschäftsleitung
        </h4>
        {entry.objections.length === 0 ? (
          <p className="text-sm text-slate-500">Keine.</p>
        ) : (
          <ul className="space-y-1">
            {entry.objections.map((o) => (
              <li
                key={o.id}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-sm"
              >
                <div>{o.reason}</div>
                <div className="text-xs text-slate-500">
                  {[o.byWhom, o.date].filter(Boolean).join(" · ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Vertraulich – nur hier sichtbar */}
      <div className="confidential-block rounded p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="lock" size={16} />
          Vertraulich – genaue Tätigkeit (BR-Geheimnis)
        </h4>
        <p className="whitespace-pre-wrap text-sm">
          {entry.secretDetails ? (
            entry.secretDetails
          ) : (
            <span className="text-red-400">— nichts erfasst —</span>
          )}
        </p>
      </div>

      <div className="flex justify-between gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          className="rounded px-3 py-2 text-sm text-red-700 hover:bg-red-50"
          onClick={onDelete}
        >
          Löschen
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            onClick={onClose}
          >
            Schließen
          </button>
          <button
            type="button"
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            onClick={onEdit}
          >
            Bearbeiten
          </button>
        </div>
      </div>
    </div>
  );
}
