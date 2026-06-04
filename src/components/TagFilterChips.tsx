import { useState } from "react";
import type { TaskTag } from "../types";

interface Props {
  tags: TaskTag[]; // nur nicht-archivierte
  selected: string[];
  onToggle: (tagId: string) => void;
  onClear: () => void;
}

const COLLAPSE_THRESHOLD = 8;

export default function TagFilterChips({
  tags,
  selected,
  onToggle,
  onClear,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (tags.length === 0) return null;

  const collapsible = tags.length > COLLAPSE_THRESHOLD;
  const visible =
    collapsible && !expanded ? tags.slice(0, COLLAPSE_THRESHOLD) : tags;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((t) => {
        const active = selected.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onToggle(t.id)}
            className={
              "rounded-full border px-3 py-1 text-xs transition " +
              (active
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")
            }
          >
            {t.label}
          </button>
        );
      })}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-full px-2 py-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
        >
          {expanded
            ? "Weniger"
            : `Mehr anzeigen (${tags.length - COLLAPSE_THRESHOLD})`}
        </button>
      )}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-1 text-xs text-slate-500 hover:underline dark:text-slate-400"
        >
          Filter zurücksetzen
        </button>
      )}
    </div>
  );
}
