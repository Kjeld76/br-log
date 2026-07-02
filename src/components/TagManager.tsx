import { useEffect, useState } from "react";
import type { TaskTag } from "../types";
import {
  listTags,
  createTag,
  renameTag,
  setTagArchived,
} from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { inputCls } from "../lib/ui";

interface Props {
  onChanged: () => void;
  // Finding 33: TagManager hielt bisher eine eigene, nur einmal im Mount-Effekt
  // geladene Tag-Kopie. Nach einem Backup-Import mit neuen Schlagwörtern
  // (App -> DataView.onChanged -> App bumpt reloadKey) bekam TagManager davon
  // nichts mit und zeigte die neuen Tags erst nach View-Wechsel. reloadKey wird
  // jetzt durchgereicht (dieselbe zentrale Quelle wie EntryList/CalendarView).
  reloadKey: number;
}

export default function TagManager({ onChanged, reloadKey }: Props) {
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Finding 22: reload/mutate hatten weder catch noch Nutzer-Feedback --
  // ein fehlgeschlagenes Laden/Anlegen/Umbenennen/Archivieren blieb unsichtbar.
  const reload = async () => {
    try {
      setTags(await listTags(true));
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  useEffect(() => {
    void reload();
  }, [reloadKey]);

  const mutate = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  // Anlegen mit busy-Guard: verhindert parallele createTag-Aufrufe (Doppel-Klick
  // /Doppel-Enter, solange das Feld noch nicht geleert ist) und zeigt Fehler
  // (z. B. „existiert bereits") in der UI an, statt sie stumm zu verschlucken.
  const addTag = async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createTag(label);
      setNewLabel("");
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const active = tags.filter((t) => !t.archived);
  const archived = tags.filter((t) => t.archived);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className={inputCls + " flex-1"}
          placeholder="Neues Schlagwort"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addTag();
          }}
        />
        <button
          type="button"
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          disabled={!newLabel.trim() || busy}
          onClick={() => void addTag()}
        >
          Hinzufügen
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

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
          className={inputCls + " flex-1"}
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
