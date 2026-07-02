import { useState } from "react";
import type { TaskTag } from "../types";
import TagChip from "./TagChip";

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
      {visible.map((t) => (
        <TagChip
          key={t.id}
          variant="selectable"
          label={t.label}
          active={selected.includes(t.id)}
          onClick={() => onToggle(t.id)}
        />
      ))}
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
