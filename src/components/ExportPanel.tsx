import { useState } from "react";
import type { BackupPayload, ImportSummary } from "../types";
import {
  exportGlCsv,
  exportFullCsv,
  exportJsonBackup,
  pickAndReadBackup,
} from "../export/exporters";
import { analyzeImport, applyImport } from "../db/repository";

interface Props {
  onImported: () => void;
}

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

  const btn =
    "w-full rounded border border-slate-300 px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => run(exportGlCsv, "GL-CSV")}
        >
          <div className="font-medium">CSV-Export für die Geschäftsleitung</div>
          <div className="text-xs text-slate-500">
            Ohne vertrauliche Tätigkeitsdetails (BR-Geheimnis bleibt geschützt).
          </div>
        </button>

        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => run(exportFullCsv, "Voll-CSV")}
        >
          <div className="font-medium">Vollständiger CSV-Export (nur für dich)</div>
          <div className="text-xs text-slate-500">
            Inklusive vertraulicher Tätigkeitsdetails.
          </div>
        </button>

        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => run(exportJsonBackup, "JSON-Backup")}
        >
          <div className="font-medium">JSON-Backup speichern</div>
          <div className="text-xs text-slate-500">
            Vollständige Sicherung / Übertragung auf ein anderes Gerät.
          </div>
        </button>

        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={startImport}
        >
          <div className="font-medium">JSON-Backup importieren</div>
          <div className="text-xs text-slate-500">
            Merge mit Konfliktprüfung – neuere Version gewinnt.
          </div>
        </button>
      </div>

      {/* Konflikt-Zusammenfassung + Bestätigung */}
      {pending && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Import-Vorschau</p>
          <ul className="mt-1 list-inside list-disc text-amber-900">
            <li>{pending.summary.newEntries} neue Einträge</li>
            <li>
              {pending.summary.conflicts} Konflikte (neuere Version gewinnt)
            </li>
            <li>{pending.summary.unchanged} unverändert</li>
            <li>{pending.summary.newTags} neue Schlagwörter</li>
          </ul>

          {pending.summary.conflictItems.length > 0 && (
            <div className="mt-2 rounded border border-amber-200 bg-white/60 p-2">
              <p className="text-xs font-semibold text-amber-900">
                Diese {pending.summary.conflictItems.length} lokalen Einträge
                würden überschrieben:
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {pending.summary.conflictItems.map((c) => (
                  <li key={c.id} className="text-xs text-amber-900">
                    <span className="font-medium">{c.date}</span> — {c.label}
                    <span className="ml-1 text-amber-700/70">
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
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-white"
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
        <p className="break-all rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          {status}
        </p>
      )}
      {error && (
        <p className="break-all rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
