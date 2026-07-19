import { useState } from "react";
import {
  exportGlCsv,
  exportFullCsv,
  exportJsonBackup,
  pickAndReadBackup,
  exportIcs,
  analyzeIcsFile,
  applyIcsPlan,
} from "../export/exporters";
import { analyzeImport, applyImport } from "../db/repository";
import { backupNow } from "../db/client";
import { toUserMessage } from "../lib/errors";
import { inputCls } from "../lib/ui";
import { icsImportPreview, jsonImportPreview, type ImportPreview } from "../lib/importPreview";
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
  // Generischer Pending-Import-Zustand: EINE Vorschau + EIN Anwenden-Schritt
  // für beide Importquellen (JSON-Backup, ICS). Eine dritte Importquelle
  // bräuchte künftig nur noch startX + einen Builder in lib/importPreview.ts.
  const [pendingImport, setPendingImport] = useState<{
    preview: ImportPreview;
    apply: () => Promise<string>;
  } | null>(null);
  // ICS: Vertraulich-Haken (Export).
  const [icsConfidential, setIcsConfidential] = useState(false);

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
      // Die hier berechnete Vorschau wird beim bestätigten Import
      // wiederverwendet (precomputedSummary) -- die Konflikt-/Tag-Analyse
      // läuft dadurch nicht zusätzlich ein zweites Mal (Finding 32).
      const summary = await analyzeImport(payload);
      setPendingImport({
        preview: jsonImportPreview(summary),
        apply: async () => {
          const s = await applyImport(payload, summary);
          return `Import abgeschlossen: ${s.newEntries} neu, ${s.conflicts} aktualisiert, ${s.unchanged} unverändert.`;
        },
      });
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
      setPendingImport({
        preview: icsImportPreview(plan),
        apply: async () => {
          await applyIcsPlan(plan);
          return `ICS-Import abgeschlossen: ${plan.newCount} neu, ${plan.updatedCount} aktualisiert, ${plan.unchangedCount} unverändert.`;
        },
      });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingImport = async () => {
    if (!pendingImport) return;
    setBusy(true);
    setError(null);

    // Sicherheits-Backup VOR dem destruktiven Merge (Finding 24): ohne ein
    // funktionierendes Backup gäbe es nach einem bereuten/fehlerhaften Import
    // keinen Rückweg. Gilt für BEIDE Quellen -- gerade der ICS-Import kann
    // bestehende Serien ERSETZEN. Schlägt die Sicherung fehl, wird NICHT
    // importiert.
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
      const message = await pendingImport.apply();
      setStatus(message);
      setPendingImport(null);
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
    "w-full rounded border border-empty-line bg-surface px-4 py-3 text-left text-sm text-primary-ink hover:bg-surface-2 disabled:opacity-50";
  const field = inputCls;

  return (
    <div className="space-y-4">
      {/* Zeitraumauswahl -- gilt nur für die beiden CSV-Exporte darunter. */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-cell-muted p-3 text-sm text-secondary-ink">
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
            className="text-xs text-secondary-ink hover:underline"
            onClick={() => {
              setCsvFrom("");
              setCsvTo("");
            }}
          >
            Zeitraum löschen
          </button>
        )}
        <span className="w-full text-xs text-disabled-ink">
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
                <div className="text-xs text-secondary-ink">
                  {a.desc}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Vertraulich-Option des ICS-Exports: bewusst opt-in mit rotem
          Warnhinweis -- das BR-Geheimnis verlässt sonst nie die App. */}
      <label className="flex items-start gap-2 rounded border border-border bg-cell-muted p-3 text-sm text-secondary-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={icsConfidential}
          onChange={(e) => setIcsConfidential(e.target.checked)}
        />
        <span>
          Vertrauliche Notizen in den ICS-Export einschließen
          {icsConfidential && (
            <span className="mt-1 block text-xs font-medium text-destructive-ink">
              Achtung: Die Datei enthält dann das BR-Geheimnis im Klartext –
              nur für die eigene, sichere Verwendung.
            </span>
          )}
        </span>
      </label>

      {/* Generisches Import-Vorschau-Panel + Bestätigung -- gilt für beide
          Importquellen (JSON-Backup, ICS); eine dritte bräuchte künftig nur
          noch startX + einen Builder in lib/importPreview.ts. */}
      {pendingImport && (
        <div className="rounded border border-warning-action-line bg-warning-banner p-3 text-sm">
          <p className="font-medium text-warning-banner-ink">
            {pendingImport.preview.title}
          </p>
          <ul className="mt-1 list-inside list-disc text-warning-banner-ink">
            {pendingImport.preview.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>

          {pendingImport.preview.detail && (
            <div className="mt-2 rounded border border-warning-banner-line bg-veil p-2">
              <p className="text-xs font-semibold text-warning-banner-ink">
                {pendingImport.preview.detail.heading}
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {pendingImport.preview.detail.lines.map((line, i) => (
                  <li key={i} className="text-xs text-warning-banner-ink">
                    {line.strong && (
                      <span className="font-medium">{line.strong}</span>
                    )}
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded border border-border-strong px-3 py-1.5 text-sm text-primary-ink hover:bg-tile-hover"
              onClick={() => setPendingImport(null)}
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="rounded bg-warning-action px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-warning-action-hover"
              onClick={confirmPendingImport}
              disabled={busy}
            >
              Import starten
            </button>
          </div>
        </div>
      )}

      {status && (
        <p className="break-all rounded bg-success-surface px-3 py-2 text-sm text-success-ink">
          {status}
        </p>
      )}
      {error && (
        <p className="break-all rounded bg-error-surface px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
