import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listEntries } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { inputCls, secondaryBtnCls } from "../lib/ui";
import { isWindows } from "../lib/platform";
// Nur der Typ wird statisch importiert (wird wegkompiliert) -- das Modul
// selbst kommt per dynamic import, damit jsPDF (~420 kB) nicht im
// Haupt-Chunk landet und den App-Start nicht verlangsamt.
import type { ReportModel } from "../export/reportPdf";
import { Icon } from "./Icon";
import { PRINT } from "../lib/tokens";

// Finding 13: druckbarer Monats-/Zeitraumnachweis. Linux-Portierung (L5):
// window.print() + Print-CSS (styles.css, #print-report-Regel) bleibt NUR
// unter Windows verfügbar (WebView2 bringt den Systemdruckdialog inkl.
// "Als PDF speichern" mit) -- unter WebKitGTK/Linux ist der Druckpfad
// unzuverlässig, unter Android fehlt er ganz. Auf ALLEN Plattformen gibt es
// jetzt zusätzlich einen echten PDF-Export via jsPDF (export/reportPdf.ts),
// über denselben export_binary_file-Command wie andere Binärexporte.
// Nutzt listEntries (GL-taugliche Spalten ohne secretDetails), da der
// Nachweis typischerweise zur Vorlage gedacht ist.

const NAME_KEY = "brlog.reportName";

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveName(v: string): void {
  try {
    localStorage.setItem(NAME_KEY, v);
  } catch {
    // Persistenz ist nur Komfort, kein Pflichtpfad.
  }
}

const cellStyle: React.CSSProperties = {
  border: `1px solid ${PRINT.tableBorder}`,
  padding: "3px 6px",
  textAlign: "left",
};

export default function PrintReportPanel() {
  const [name, setName] = useState(() => loadName());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [model, setModel] = useState<ReportModel | null>(null);

  const buildReport = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const { buildReportModel } = await import("../export/reportPdf");
      const entries = await listEntries({
        from: from || undefined,
        to: to || undefined,
      });
      setModel(
        buildReportModel(entries, (e) => e.tagLabels.join(", "), {
          name,
          from,
          to,
        })
      );
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doPrint = () => {
    saveName(name);
    window.print();
  };

  const doSavePdf = async () => {
    if (!model) return;
    saveName(name);
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const { renderReportPdf, uint8ToBase64 } = await import(
        "../export/reportPdf"
      );
      const bytes = renderReportPdf(model);
      const path = await invoke<string | null>("export_binary_file", {
        defaultName: `${model.fileBaseName}.pdf`,
        filterName: "PDF-Datei",
        extension: "pdf",
        contentsBase64: uint8ToBase64(bytes),
      });
      setStatus(path ? `PDF gespeichert: ${path}` : "Abgebrochen.");
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = inputCls + " mt-1 w-full";

  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-surface p-4">
        <p className="mb-3 text-xs text-secondary-ink">
          Nachweis für einen Zeitraum (Berichtskopf, Zeilen, Summe,
          Freizeitausgleich, Unterschriftsfelder) – als PDF speicherbar auf
          allen Plattformen, unter Windows zusätzlich über den
          Systemdruckdialog.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-secondary-ink">
            Name (Berichtskopf)
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- und Nachname"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-sm text-secondary-ink">
              Von
              <input
                type="date"
                className={field}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex-1 text-sm text-secondary-ink">
              Bis
              <input
                type="date"
                className={field}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
            onClick={buildReport}
            disabled={busy}
          >
            {busy ? "Erstellt…" : "Nachweis erstellen"}
          </button>
          {model && (
            <button
              type="button"
              className={"flex items-center gap-1.5 " + secondaryBtnCls}
              onClick={doSavePdf}
              disabled={busy}
            >
              <Icon name="download" size={16} />
              Als PDF speichern
            </button>
          )}
          {/* WebKitGTK (Linux) druckt unzuverlässig, Android hat gar keinen
              Druckdialog -- der Systemdruckdialog bleibt deshalb Windows-only.
              Der PDF-Export oben deckt Linux/Android/Windows gleichermaßen ab. */}
          {model && isWindows() && (
            <button
              type="button"
              className={"flex items-center gap-1.5 " + secondaryBtnCls}
              onClick={doPrint}
              disabled={busy}
            >
              <Icon name="printer" size={16} />
              Drucken
            </button>
          )}
        </div>
        {status && (
          <p className="mt-2 break-all text-sm text-success-ink">
            {status}
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm text-error-ink">
            {error}
          </p>
        )}
      </div>

      {model && (
        <div className="rounded border border-border bg-surface p-3 text-xs text-secondary-ink">
          Vorschau: {model.rows.length} Einträge. Zeigt exakt den Inhalt des
          PDF-Exports (unter Windows auch des Drucks) – nicht die
          App-Oberfläche.
        </div>
      )}

      {/* Sichtbare Vorschau (Linux-Portierung, L5): war zuvor per CSS auf dem
          Bildschirm ausgeblendet und nur beim Drucken sichtbar. Jetzt eine
          reguläre, immer sichtbare Vorschau -- speist sich aus DEMSELBEN
          Modell wie der PDF-Export, kann also nicht vom PDF abweichen.
          styles.css schaltet #print-report beim Drucken weiterhin exklusiv
          frei (Rest der App wird ausgeblendet); das gilt unverändert, auch
          wenn der Block jetzt schon vorher sichtbar ist. */}
      {model && (
        <div id="print-report">
          <h1 style={{ fontSize: "16pt", marginBottom: 4 }}>{model.title}</h1>
          <table style={{ width: "100%", fontSize: "10pt", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={{ width: "20%" }}>Name</td>
                <td>{model.name}</td>
              </tr>
              <tr>
                <td>Zeitraum</td>
                <td>{model.periodLabel}</td>
              </tr>
              <tr>
                <td>Erstellt am</td>
                <td>{model.createdAtLabel}</td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: "100%", fontSize: "9pt", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {model.columns.map((c) => (
                  <th key={c} style={cellStyle}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r, i) => (
                <tr key={i}>
                  <td style={cellStyle}>{r.date}</td>
                  <td style={cellStyle}>{r.start}</td>
                  <td style={cellStyle}>{r.end}</td>
                  <td style={cellStyle}>{r.pause}</td>
                  <td style={cellStyle}>{r.duration}</td>
                  <td style={cellStyle}>{r.tags}</td>
                  <td style={cellStyle}>{r.info}</td>
                  <td style={cellStyle}>{r.shift}</td>
                </tr>
              ))}
              {model.rows.length === 0 && (
                <tr>
                  <td style={cellStyle} colSpan={model.columns.length}>
                    Keine Einträge in diesem Zeitraum.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={cellStyle} colSpan={4}>
                  <strong>{model.totalLabel}</strong>
                </td>
                <td style={cellStyle}>
                  <strong>{model.totalValue}</strong>
                </td>
                <td style={cellStyle} colSpan={3}></td>
              </tr>
            </tfoot>
          </table>

          <p style={{ fontSize: "9pt", marginTop: 8 }}>
            <strong>Freizeitausgleich in diesem Zeitraum: </strong>
            {model.compensationLabel}
          </p>

          <div
            style={{
              marginTop: 40,
              display: "flex",
              justifyContent: "space-between",
              fontSize: "9pt",
              gap: 16,
            }}
          >
            {model.signatureLabels.map((label) => (
              <div
                key={label}
                style={{
                  width: "30%",
                  borderTop: `1px solid ${PRINT.ink}`,
                  paddingTop: 4,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
