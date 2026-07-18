import { useState } from "react";
import type { BackupPayload, ImportSummary } from "../types";
import {
  exportGlCsv,
  exportFullCsv,
  exportJsonBackup,
  pickAndReadBackup,
  exportIcs,
  analyzeIcsFile,
  applyIcsPlan,
  type IcsImportPlan,
} from "../export/exporters";
import { analyzeImport, applyImport } from "../db/repository";
import { backupNow } from "../db/client";
import { toUserMessage } from "../lib/errors";
import { inputCls } from "../lib/ui";
import { Icon, type IconName } from "./Icon";

interface Props {
  onImported: () => void;
}

const ACTIONS: {
  icon: IconName;
  title: string;
  desc: string;
  key: "gl" | "full" | "backup" | "import" | "icsExport" | "icsImport";
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
    desc: "Daten von einem anderen Gerät übernehmen (bei doppelten Einträgen gewinnt automatisch die neuere Version).",
    key: "import",
  },
  {
    icon: "calendar",
    title: "Termine als ICS exportieren",
    desc: "Alle Kalender-Termine im iCalendar-Format (für Outlook, Thunderbird, Google Kalender). Standardmäßig OHNE vertrauliche Notizen.",
    key: "icsExport",
  },
  {
    icon: "calendar",
    title: "ICS-Datei importieren",
    desc: "Termine aus einem anderen Kalender übernehmen (bei bekannten Terminen entscheidet die Versionsnummer der Datei).",
    key: "icsImport",
  },
];

export default function ExportPanel({ onImported }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Finding 8: Zeitraumauswahl für die CSV-Exporte (EntryFilter.from/to
  // existierte im Repository bereits, wurde aus der UI nur nicht durchgereicht
  // -- ohne Auswahl bleibt es der vollständige Bestand). Gilt bewusst NICHT
  // für das JSON-Backup (vollständige Datensicherung/Geräteübertragung).
  const [csvFrom, setCsvFrom] = useState("");
  const [csvTo, setCsvTo] = useState("");
  const [pending, setPending] = useState<{
    payload: BackupPayload;
    summary: ImportSummary;
  } | null>(null);
  // ICS: Vertraulich-Haken (Export) + Import-Vorschau.
  const [icsConfidential, setIcsConfidential] = useState(false);
  const [icsPending, setIcsPending] = useState<IcsImportPlan | null>(null);

  const run = async (fn: () => Promise<string | null>, label: string) => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const path = await fn();
      setStatus(path ? `${label} gespeichert: ${path}` : "Abgebrochen.");
    } catch (e) {
      setError(toUserMessage(e));
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
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);

    // Sicherheits-Backup VOR dem destruktiven Merge (Finding 24): ohne ein
    // funktionierendes Backup gäbe es nach einem bereuten/fehlerhaften Import
    // keinen Rückweg. Schlägt die Sicherung fehl, wird NICHT importiert.
    try {
      await backupNow();
    } catch (e) {
      setError(
        `Import abgebrochen: Das Sicherheits-Backup vor dem Import ist fehlgeschlagen. ${toUserMessage(
          e
        )}`
      );
      setBusy(false);
      return;
    }

    try {
      // Die bereits in startImport berechnete Vorschau wird wiederverwendet
      // (precomputedSummary) -- die Konflikt-/Tag-Analyse läuft dadurch nicht
      // zusätzlich ein zweites Mal beim bestätigten Import (Finding 32).
      const s = await applyImport(pending.payload, pending.summary);
      setStatus(
        `Import abgeschlossen: ${s.newEntries} neu, ${s.conflicts} aktualisiert, ${s.unchanged} unverändert.`
      );
      setPending(null);
      onImported();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const startIcsImport = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const plan = await analyzeIcsFile();
      if (!plan) {
        setStatus("Abgebrochen.");
        return;
      }
      setIcsPending(plan);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmIcsImport = async () => {
    if (!icsPending) return;
    setBusy(true);
    setError(null);
    // Sicherheits-Backup wie beim JSON-Import (Finding 24): der ICS-Import
    // kann bestehende Serien ERSETZEN -- ohne Backup kein Rückweg.
    try {
      await backupNow();
    } catch (e) {
      setError(
        `Import abgebrochen: Das Sicherheits-Backup vor dem Import ist fehlgeschlagen. ${toUserMessage(
          e
        )}`
      );
      setBusy(false);
      return;
    }
    try {
      await applyIcsPlan(icsPending);
      setStatus(
        `ICS-Import abgeschlossen: ${icsPending.newCount} neu, ${icsPending.updatedCount} aktualisiert, ${icsPending.unchangedCount} unverändert.`
      );
      setIcsPending(null);
      onImported();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onClick = (key: string) => {
    const period = { from: csvFrom || undefined, to: csvTo || undefined };
    if (key === "gl") return run(() => exportGlCsv(period), "GL-CSV");
    if (key === "full") return run(() => exportFullCsv(period), "Voll-CSV");
    if (key === "backup") return run(exportJsonBackup, "JSON-Backup");
    if (key === "import") return startImport();
    if (key === "icsExport")
      return run(() => exportIcs(icsConfidential), "ICS-Datei");
    if (key === "icsImport") return startIcsImport();
  };

  const btn =
    "w-full rounded border border-slate-300 bg-white px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  const field = inputCls;

  return (
    <div className="space-y-4">
      {/* Zeitraumauswahl -- gilt nur für die beiden CSV-Exporte darunter. */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
        <span>CSV-Zeitraum:</span>
        <input
          type="date"
          className={field}
          value={csvFrom}
          onChange={(e) => setCsvFrom(e.target.value)}
        />
        <span>–</span>
        <input
          type="date"
          className={field}
          value={csvTo}
          onChange={(e) => setCsvTo(e.target.value)}
        />
        {(csvFrom || csvTo) && (
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline dark:text-slate-400"
            onClick={() => {
              setCsvFrom("");
              setCsvTo("");
            }}
          >
            Zeitraum löschen
          </button>
        )}
        <span className="w-full text-xs text-slate-400 dark:text-slate-500">
          Leer = gesamter Bestand. Gilt nur für die CSV-Exporte, nicht für das
          JSON-Backup (immer vollständig).
        </span>
      </div>

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

      {/* Vertraulich-Option des ICS-Exports: bewusst opt-in mit rotem
          Warnhinweis -- das BR-Geheimnis verlässt sonst nie die App. */}
      <label className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={icsConfidential}
          onChange={(e) => setIcsConfidential(e.target.checked)}
        />
        <span>
          Vertrauliche Notizen in den ICS-Export einschließen
          {icsConfidential && (
            <span className="mt-1 block text-xs font-medium text-red-700 dark:text-red-400">
              Achtung: Die Datei enthält dann das BR-Geheimnis im Klartext –
              nur für die eigene, sichere Verwendung.
            </span>
          )}
        </span>
      </label>

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
            {(pending.summary.newAppointments ?? 0) +
              (pending.summary.appointmentConflicts ?? 0) +
              (pending.summary.appointmentUnchanged ?? 0) >
              0 && (
              <li>
                Termine: {pending.summary.newAppointments ?? 0} neu,{" "}
                {pending.summary.appointmentConflicts ?? 0} aktualisiert,{" "}
                {pending.summary.appointmentUnchanged ?? 0} unverändert
              </li>
            )}
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

      {/* ICS-Import-Vorschau + Bestätigung (Muster der Backup-Vorschau) */}
      {icsPending && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            ICS-Import-Vorschau
          </p>
          <ul className="mt-1 list-inside list-disc text-amber-900 dark:text-amber-200">
            <li>{icsPending.newCount} neue Termine</li>
            <li>
              {icsPending.updatedCount} aktualisiert (bestehende Serie/Termin
              wird ersetzt)
            </li>
            <li>{icsPending.unchangedCount} unverändert</li>
          </ul>

          {icsPending.warnings.length > 0 && (
            <div className="mt-2 rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-800 dark:bg-black/20">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Hinweise:
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {icsPending.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-900 dark:text-amber-200">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => setIcsPending(null)}
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              onClick={confirmIcsImport}
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
