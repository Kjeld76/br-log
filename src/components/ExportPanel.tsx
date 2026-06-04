import { useState } from "react";
import type { BackupPayload, ImportSummary } from "../types";
import {
  exportGlCsv,
  exportFullCsv,
  exportJsonBackup,
  pickAndReadBackup,
} from "../export/exporters";
import { analyzeImport, applyImport } from "../db/repository";
import { Icon, type IconName } from "./Icon";

interface Props {
  onImported: () => void;
}

const ACTIONS: {
  icon: IconName;
  title: string;
  desc: string;
  key: "gl" | "full" | "backup" | "import";
}[] = [
  {
    icon: "eye",
    title: "CSV-Export für die Geschäftsleitung",
    desc: "Ohne vertrauliche Tätigkeitsdetails (BR-Geheimnis bleibt geschützt).",
    key: "gl",
  },
  {
    icon: "lock",
    title: "Vollständiger CSV-Export (nur für dich)",
    desc: "Inklusive vertraulicher Tätigkeitsdetails.",
    key: "full",
  },
  {
    icon: "download",
    title: "JSON-Backup speichern",
    desc: "Vollständige Sicherung / Übertragung auf ein anderes Gerät.",
    key: "backup",
  },
  {
    icon: "upload",
    title: "JSON-Backup importieren",
    desc: "Merge mit Konfliktprüfung – neuere Version gewinnt.",
    key: "import",
  },
];

export default function ExportPanel({ onImported }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    payload: BackupPayload;
    summary: ImportSummary;
  } | null>(null);

  const run = async (fn: () => Promise<string | null>, label: string) => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const path = await fn();
      setStatus(path ? `${label} gespeichert: ${path}` : "Abgebrochen.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startImport = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const payload = await pickAndReadBackup();
      if (!payload) {
        setStatus("Abgebrochen.");
        return;
      }
      const summary = await analyzeImport(payload);
      setPending({ payload, summary });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const s = await applyImport(pending.payload);
      setStatus(
        `Import abgeschlossen: ${s.newEntries} neu, ${s.conflicts} aktualisiert, ${s.unchanged} unverändert.`
      );
      setPending(null);
      onImported();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onClick = (key: string) => {
    if (key === "gl") return run(exportGlCsv, "GL-CSV");
    if (key === "full") return run(exportFullCsv, "Voll-CSV");
    if (key === "backup") return run(exportJsonBackup, "JSON-Backup");
    if (key === "import") return startImport();
  };

  const btn =
    "w-full rounded border border-slate-300 bg-white px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => onClick(a.key)}
          >
            <div className="flex items-start gap-3">
              <Icon name={a.icon} size={20} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {a.desc}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Konflikt-Zusammenfassung + Bestätigung */}
      {pending && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Import-Vorschau
          </p>
          <ul className="mt-1 list-inside list-disc text-amber-900 dark:text-amber-200">
            <li>{pending.summary.newEntries} neue Einträge</li>
            <li>
              {pending.summary.conflicts} Konflikte (neuere Version gewinnt)
            </li>
            <li>{pending.summary.unchanged} unverändert</li>
            <li>{pending.summary.newTags} neue Schlagwörter</li>
          </ul>

          {pending.summary.conflictItems.length > 0 && (
            <div className="mt-2 rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-800 dark:bg-black/20">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Diese {pending.summary.conflictItems.length} lokalen Einträge
                würden überschrieben:
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {pending.summary.conflictItems.map((c) => (
                  <li
                    key={c.id}
                    className="text-xs text-amber-900 dark:text-amber-200"
                  >
                    <span className="font-medium">{c.date}</span> — {c.label}
                    <span className="ml-1 opacity-70">
                      ({c.id.slice(0, 8)}…)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              onClick={confirmImport}
              disabled={busy}
            >
              Import starten
            </button>
          </div>
        </div>
      )}

      {status && (
        <p className="break-all rounded bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
          {status}
        </p>
      )}
      {error && (
        <p className="break-all rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
