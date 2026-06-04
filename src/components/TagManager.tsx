import { useEffect, useState } from "react";
import type { TaskTag } from "../types";
import {
  listTags,
  createTag,
  renameTag,
  setTagArchived,
} from "../db/repository";

interface Props {
  onChanged: () => void;
}

export default function TagManager({ onChanged }: Props) {
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [newLabel, setNewLabel] = useState("");

  const reload = () => listTags(true).then(setTags);

  useEffect(() => {
    reload();
  }, []);

  const mutate = async (fn: () => Promise<unknown>) => {
    await fn();
    await reload();
    onChanged();
  };

  const active = tags.filter((t) => !t.archived);
  const archived = tags.filter((t) => t.archived);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          placeholder="Neues Schlagwort"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newLabel.trim()) {
              mutate(() => createTag(newLabel)).then(() => setNewLabel(""));
            }
          }}
        />
        <button
          type="button"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          disabled={!newLabel.trim()}
          onClick={() =>
            mutate(() => createTag(newLabel)).then(() => setNewLabel(""))
          }
        >
          Hinzufügen
        </button>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Aktiv
        </h4>
        <ul className="space-y-1">
          {active.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              onRename={(label) => mutate(() => renameTag(t.id, label))}
              onArchive={() => mutate(() => setTagArchived(t.id, true))}
            />
          ))}
          {active.length === 0 && (
            <li className="text-sm text-slate-500 dark:text-slate-400">
              Keine aktiven Schlagwörter.
            </li>
          )}
        </ul>
      </div>

      {archived.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Archiviert
          </h4>
          <ul className="space-y-1">
            {archived.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400"
              >
                <span>{t.label}</span>
                <button
                  type="button"
                  className="text-xs text-sky-700 hover:underline dark:text-sky-400"
                  onClick={() => mutate(() => setTagArchived(t.id, false))}
                >
                  Reaktivieren
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TagRow({
  tag,
  onRename,
  onArchive,
}: {
  tag: TaskTag;
  onRename: (label: string) => void;
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(tag.label);

  return (
    <li className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
      {editing ? (
        <input
          className="flex-1 rounded border border-slate-300 bg-white p-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              onRename(label);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setLabel(tag.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span className="text-slate-800 dark:text-slate-200">{tag.label}</span>
      )}
      <div className="ml-2 flex shrink-0 gap-2">
        {editing ? (
          <button
            type="button"
            className="text-xs text-sky-700 hover:underline dark:text-sky-400"
            onClick={() => {
              if (label.trim()) onRename(label);
              setEditing(false);
            }}
          >
            Speichern
          </button>
        ) : (
          <button
            type="button"
            className="text-xs text-slate-600 hover:underline dark:text-slate-300"
            onClick={() => setEditing(true)}
          >
            Umbenennen
          </button>
        )}
        <button
          type="button"
          className="text-xs text-slate-500 hover:underline dark:text-slate-400"
          onClick={onArchive}
        >
          Archivieren
        </button>
      </div>
    </li>
  );
}
