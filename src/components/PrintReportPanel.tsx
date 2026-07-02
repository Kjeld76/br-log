import { useState } from "react";
import { format } from "date-fns";
import { listEntries } from "../db/repository";
import type { EntryListItem } from "../types";
import { minutesToHhmm } from "../lib/time";
import { formatDateDe } from "../lib/calendar";
import { toUserMessage } from "../lib/errors";
import { Icon } from "./Icon";

// Finding 13: druckbarer Monats-/Zeitraumnachweis. Bewusst window.print() +
// Print-CSS (siehe #print-report-Regel in styles.css) statt eines PDF-Plugins
// -- WebView2 bringt den Systemdruckdialog inkl. "Als PDF speichern" mit,
// keine neue Dependency nötig. Nutzt listEntries (GL-taugliche Spalten ohne
// secretDetails), da der Nachweis typischerweise zur Vorlage gedacht ist.

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

interface ReportData {
  name: string;
  from: string;
  to: string;
  workEntries: EntryListItem[];
  compensationEntries: EntryListItem[];
  totalMinutes: number;
  compensationMinutes: number;
  createdAt: string;
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #999",
  padding: "3px 6px",
  textAlign: "left",
};

export default function PrintReportPanel() {
  const [name, setName] = useState(() => loadName());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);

  const buildReport = async () => {
    setError(null);
    setBusy(true);
    try {
      const entries = await listEntries({
        from: from || undefined,
        to: to || undefined,
      });
      entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      // Ausgleichs-Einträge sind keine BR-Tätigkeit (Finding 14) -- eigene
      // Zeile statt sie in die Arbeitszeit-Zeilen/Summe zu mischen.
      const workEntries = entries.filter((e) => !e.isCompensation);
      const compensationEntries = entries.filter((e) => e.isCompensation);
      setReport({
        name: name.trim(),
        from,
        to,
        workEntries,
        compensationEntries,
        totalMinutes: workEntries.reduce((s, e) => s + e.durationMinutes, 0),
        compensationMinutes: compensationEntries.reduce(
          (s, e) => s + e.durationMinutes,
          0
        ),
        createdAt: formatDateDe(format(new Date(), "yyyy-MM-dd")),
      });
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

  const field =
    "mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Druckbarer Nachweis für einen Zeitraum (Berichtskopf, Zeilen, Summe,
          Freizeitausgleich, Unterschriftsfelder) – öffnet den
          Systemdruckdialog, dort auch als PDF speicherbar.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            Name (Berichtskopf)
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- und Nachname"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-sm text-slate-600 dark:text-slate-300">
              Von
              <input
                type="date"
                className={field}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex-1 text-sm text-slate-600 dark:text-slate-300">
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
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            onClick={buildReport}
            disabled={busy}
          >
            {busy ? "Erstellt…" : "Nachweis erstellen"}
          </button>
          {report && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={doPrint}
            >
              <Icon name="printer" size={16} />
              Drucken / als PDF speichern
            </button>
          )}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {report && (
        <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Vorschau erstellt: {report.workEntries.length} Einträge
          {report.compensationEntries.length > 0
            ? `, ${report.compensationEntries.length} Freizeitausgleich-Termin(e)`
            : ""}
          . Drucken zeigt ausschließlich den Nachweis, nicht die
          App-Oberfläche.
        </div>
      )}

      {/* Druckbereich: auf dem Bildschirm ausgeblendet (styles.css schaltet
          #print-report beim Drucken frei und blendet den Rest der App aus). */}
      {report && (
        <div id="print-report">
          <h1 style={{ fontSize: "16pt", marginBottom: 4 }}>
            Nachweis Betriebsratszeiten
          </h1>
          <table style={{ width: "100%", fontSize: "10pt", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={{ width: "20%" }}>Name</td>
                <td>{report.name || "—"}</td>
              </tr>
              <tr>
                <td>Zeitraum</td>
                <td>
                  {report.from ? formatDateDe(report.from) : "Anfang"} –{" "}
                  {report.to ? formatDateDe(report.to) : "Ende"}
                </td>
              </tr>
              <tr>
                <td>Erstellt am</td>
                <td>{report.createdAt}</td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: "100%", fontSize: "9pt", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Datum</th>
                <th style={cellStyle}>Von</th>
                <th style={cellStyle}>Bis</th>
                <th style={cellStyle}>Dauer</th>
                <th style={cellStyle}>Schlagwörter</th>
                <th style={cellStyle}>Info für Geschäftsleitung</th>
              </tr>
            </thead>
            <tbody>
              {report.workEntries.map((e) => (
                <tr key={e.id}>
                  <td style={cellStyle}>{formatDateDe(e.date)}</td>
                  <td style={cellStyle}>{e.startTime ?? ""}</td>
                  <td style={cellStyle}>{e.endTime ?? ""}</td>
                  <td style={cellStyle}>{minutesToHhmm(e.durationMinutes)}</td>
                  <td style={cellStyle}>{e.tagLabels.join(", ")}</td>
                  <td style={cellStyle}>{e.infoForManagement}</td>
                </tr>
              ))}
              {report.workEntries.length === 0 && (
                <tr>
                  <td style={cellStyle} colSpan={6}>
                    Keine Einträge in diesem Zeitraum.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={cellStyle} colSpan={3}>
                  <strong>Summe</strong>
                </td>
                <td style={cellStyle}>
                  <strong>{minutesToHhmm(report.totalMinutes)} Std</strong>
                </td>
                <td style={cellStyle} colSpan={2}></td>
              </tr>
            </tfoot>
          </table>

          <p style={{ fontSize: "9pt", marginTop: 8 }}>
            <strong>Freizeitausgleich in diesem Zeitraum: </strong>
            {report.compensationEntries.length > 0
              ? `${minutesToHhmm(report.compensationMinutes)} Std an ${
                  report.compensationEntries.length
                } Tag(en) (${report.compensationEntries
                  .map((e) => formatDateDe(e.date))
                  .join(", ")})`
              : "keiner."}
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
            <div style={{ width: "30%", borderTop: "1px solid #000", paddingTop: 4 }}>
              Datum
            </div>
            <div style={{ width: "30%", borderTop: "1px solid #000", paddingTop: 4 }}>
              Unterschrift BR-Mitglied
            </div>
            <div style={{ width: "30%", borderTop: "1px solid #000", paddingTop: 4 }}>
              Unterschrift Geschäftsleitung
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
