import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { TaskTag } from "../types";
import { newEntry } from "../db/repository";
import EntryForm from "../components/EntryForm";

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

interface Props {
  tags: TaskTag[];
  onSaved: () => void; // App: Toast + reloadKey
}

export default function QuickEntryView({ tags, onSaved }: Props) {
  // Nach dem Speichern wird die Maske durch Remount (neuer key) geleert.
  const [formKey, setFormKey] = useState(0);
  const entry = useMemo(() => newEntry(todayIso()), [formKey]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header>
        <h2 className="text-lg font-bold text-slate-800">Zeit erfassen</h2>
        <p className="text-sm text-slate-500">
          Neuer Eintrag für deine Betriebsratszeit.
        </p>
      </header>
      <EntryForm
        key={formKey}
        entry={entry}
        tags={tags}
        onSaved={() => {
          onSaved();
          setFormKey((k) => k + 1);
        }}
      />
    </div>
  );
}
