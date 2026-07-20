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
  // Nur auf Android trifft der Deinstallations-Hinweis in der Backup-Karte
  // zu (App-Sandbox wird beim Deinstallieren geloescht) -- am Desktop bliebe
  // die Aussage falsch, siehe DbInfoPanel.tsx fuer dasselbe Gating-Muster.
  mobile?: boolean;
}

// Kompakte Aktions-Zeile: Icon + Titel (+ kurzer Untertitel, einzeilig) +
// Chevron, statt der frueheren Vollbreite-Buttons mit langen Beschreibungs-
// bloecken (Design-Handoff #27, 1f: "Kompakte Zeilen mit Chevron statt
// langer Beschreibungsbloecke"). Details, die hier wegfallen, tauchen an
// anderer Stelle wieder auf (Import-Vorschau-Panel bzw. der Vertraulich-
// Hinweis direkt unter dem ICS-Export) -- es geht nichts verloren, nur der
// Zeitpunkt verschiebt sich auf den Moment, in dem er gebraucht wird.
function ActionRow({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex min-h-touch w-full items-center gap-3 rounded border border-empty-line bg-surface px-4 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={20} className="shrink-0 text-secondary-ink" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary-ink">
          {title}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-secondary-ink">
            {subtitle}
          </span>
        )}
      </span>
      <Icon
        name="chevron-right"
        size={18}
        className="shrink-0 text-secondary-ink"
      />
    </button>
  );
}

export default function ExportPanel({ onImported, mobile }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Finding 8: Zeitraumauswahl für die CSV-Exporte (EntryFilter.from/to
  // existierte im Repository bereits, wurde aus der UI nur nicht durchgereicht
  // -- ohne Auswahl bleibt es der vollständige Bestand). Gilt bewusst NICHT
  // für das JSON-Backup (vollständige Datensicherung/Geräteübertragung) --
  // und auch nicht für den ICS-Export/-Import (Design-Handoff #27, 1f).
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

  const field = inputCls;
  const groupLabel =
    "mb-2 text-xs font-medium uppercase tracking-wide text-secondary-ink";

  return (
    <div className="space-y-6">
      {/* Sichern & übertragen: JSON-Backup (Empfehlung + Android-Datenverlust-
          Hinweis) und JSON-Import -- vollständige Sicherung/Übertragung,
          unabhängig vom CSV-Zeitraum weiter unten (Design-Handoff #27, 1f). */}
      <section>
        <h4 className={groupLabel}>Sichern &amp; übertragen</h4>
        <div className="space-y-2">
          {/* Empfohlen-Callout: einzige hervorgehobene Zeile des Panels --
              vollständige Sicherung, unabhängig von CSV-Zeitraum/Confidential-
              Haken, deshalb der empfohlene Standardweg. */}
          <button
            type="button"
            className="flex min-h-touch w-full items-start gap-3 rounded-lg border border-info-ink bg-info-badge px-4 py-3 text-left disabled:opacity-50"
            disabled={busy}
            onClick={() => onClick("backup")}
          >
            <Icon
              name="download"
              size={20}
              className="mt-0.5 shrink-0 text-info-ink"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-info-ink">
                  JSON-Backup speichern
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-info-ink">
                  Empfohlen
                </span>
              </span>
              <span className="mt-1 block text-xs text-info-ink">
                Vollständige Sicherung – auch zur Übertragung auf ein anderes
                Gerät.
              </span>
              {mobile && (
                <span className="mt-2 block rounded bg-warning-banner px-2 py-1.5 text-xs text-warning-banner-ink">
                  <strong>Achtung:</strong> Beim Deinstallieren der App werden
                  alle Daten unwiederbringlich gelöscht – dieses Backup ist
                  dann dein einziger Rettungsweg.
                </span>
              )}
            </span>
            <Icon
              name="chevron-right"
              size={18}
              className="mt-0.5 shrink-0 text-info-ink"
            />
          </button>

          <ActionRow
            icon="upload"
            title="JSON-Backup importieren"
            subtitle="Daten von einem anderen Gerät übernehmen."
            disabled={busy}
            onClick={() => onClick("import")}
          />
        </div>
      </section>

      {/* Exportieren: CSV (GL/vollständig) + ICS. Die Zeitraumauswahl gilt
          NUR für die beiden CSV-Exporte darunter, nicht für ICS oder das
          JSON-Backup oben -- Hinweistext dazu unverändert. */}
      <section>
        <h4 className={groupLabel}>Exportieren</h4>

        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-border bg-cell-muted p-3 text-sm text-secondary-ink">
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
          <ActionRow
            icon="eye"
            title="CSV-Export für die Geschäftsleitung"
            subtitle="Ohne vertrauliche Tätigkeitsdetails (BR-Geheimnis bleibt geschützt)."
            disabled={busy}
            onClick={() => onClick("gl")}
          />
          <ActionRow
            icon="lock"
            title="Vollständiger CSV-Export (nur für dich)"
            subtitle="Inklusive vertraulicher Tätigkeitsdetails."
            disabled={busy}
            onClick={() => onClick("full")}
          />
          <ActionRow
            icon="calendar"
            title="Termine als ICS exportieren"
            subtitle="Für Outlook, Thunderbird, Google Kalender."
            disabled={busy}
            onClick={() => onClick("icsExport")}
          />

          {/* Vertraulich-Option des ICS-Exports: bewusst opt-in mit rotem
              Warnhinweis -- das BR-Geheimnis verlässt sonst nie die App.
              Bleibt ein eigener, deutlich sichtbarer Block direkt unter dem
              ICS-Export (kein Teil der kompakten Zeile, keine Kürzung). */}
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

          <ActionRow
            icon="calendar"
            title="ICS-Datei importieren"
            subtitle="Termine aus einem anderen Kalender übernehmen."
            disabled={busy}
            onClick={() => onClick("icsImport")}
          />
        </div>
      </section>

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
