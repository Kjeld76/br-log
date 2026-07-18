import type { Objection } from "../types";
import { newObjection } from "../db/repository";
import { inputCls, secondaryBtnSmCls } from "../lib/ui";

interface Props {
  objections: Objection[];
  onChange: (objs: Objection[]) => void;
}

export default function ObjectionEditor({ objections, onChange }: Props) {
  const update = (id: string, patch: Partial<Objection>) =>
    onChange(objections.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const remove = (id: string) => onChange(objections.filter((o) => o.id !== id));
  const add = () => onChange([...objections, newObjection()]);

  return (
    <div className="space-y-2">
      {objections.length === 0 && (
        <p className="text-sm text-secondary-ink">
          Kein Widerspruch der Geschäftsleitung erfasst.
        </p>
      )}
      {objections.map((o) => (
        <div
          key={o.id}
          className="space-y-2 rounded border border-border bg-surface-dim p-3"
        >
          <textarea
            className={inputCls + " w-full"}
            rows={2}
            placeholder="Begründung des Widerspruchs"
            value={o.reason}
            onChange={(e) => update(o.id, { reason: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={inputCls + " min-w-[8rem] flex-1"}
              placeholder="Wer (Name/Funktion)"
              value={o.byWhom}
              onChange={(e) => update(o.id, { byWhom: e.target.value })}
            />
            <input
              type="date"
              className={inputCls}
              value={o.date ?? ""}
              onChange={(e) => update(o.id, { date: e.target.value || null })}
            />
            <button
              type="button"
              className="rounded px-2 py-1 text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              onClick={() => remove(o.id)}
            >
              Entfernen
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={secondaryBtnSmCls} onClick={add}>
        + Widerspruch hinzufügen
      </button>
    </div>
  );
}
