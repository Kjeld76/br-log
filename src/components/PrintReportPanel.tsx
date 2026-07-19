import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listEntries } from "../db/repository";
import { toUserMessage } from "../lib/errors";
import { inputCls, secondaryBtnCls } from "../lib/ui";
import { isWindows } from "../lib/platform";
import { monthRangeIso, todayIso } from "../lib/calendar";
// Nur der Typ wird statisch importiert (wird wegkompiliert) -- das Modul
// selbst kommt per dynamic import, damit jsPDF (~420 kB) nicht im
// Haupt-Chunk landet und den App-Start nicht verlangsamt.
import type { ReportModel } from "../export/reportPdf";
import { Icon } from "./Icon";
import SegmentedControl from "./SegmentedControl";
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
//
// Issue #16 (Task 3): Monats-/Zeitraum-Umschalter plus die Report-
// Einstellungen (Funktion, Betrieb/Firma, Nachname, Schlagwörter-Toggle) aus
// ReportOpts (Task 2) werden hier verdrahtet. localStorage-Persistenz folgt
// exakt dem bestehenden Name-Muster (NAME_KEY): geladen beim Mount, gesichert
// erst bei einer tatsächlichen Aktion (Drucken/PDF speichern) -- nicht bei
// jedem Tastendruck.

type Mode = "monat" | "zeitraum";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "monat", label: "Monat" },
  { value: "zeitraum", label: "Zeitraum" },
];

const NAME_KEY = "brlog.reportName";
const FUNKTION_KEY = "brlog.reportFunktion";
const BETRIEB_KEY = "brlog.reportBetrieb";
const NACHNAME_KEY = "brlog.reportNachname";
const SHOW_TAGS_KEY = "brlog.reportShowTags";

function loadStr(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function saveStr(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Persistenz ist nur Komfort, kein Pflichtpfad.
  }
}
function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}
function saveBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // Persistenz ist nur Komfort, kein Pflichtpfad.
  }
}

/**
 * Wert von `<input type="month">` ("YYYY-MM") -> voller Kalendermonat als
 * Von/Bis-Zeitraum (siehe `monthRangeIso`). Fällt auf einen leeren Zeitraum
 * zurück (= "gesamter Bestand", identische Semantik wie leere Von/Bis-Felder
 * im Zeitraum-Modus), wenn der Wert leer ist ODER nicht dem erwarteten
 * Format entspricht -- relevant für WebViews ohne natives
 * Monats-Picker-Rendering, die `type="month"` als Freitextfeld darstellen
 * und damit beliebige oder leere Werte liefern können. Bewusst kein Wurf/
 * keine Fehlermeldung für diesen Randfall, sondern derselbe stille
 * Fallback wie ein leeres Von/Bis-Feld.
 */
function monthRangeFromValue(value: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return { from: "", to: "" };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return { from: "", to: "" };
  return monthRangeIso(new Date(year, monthIndex, 1));
}

const cellStyle: React.CSSProperties = {
  border: `1px solid ${PRINT.tableBorder}`,
  padding: "3px 6px",
  textAlign: "left",
};

export default function PrintReportPanel() {
  const [mode, setMode] = useState<Mode>("monat");
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState(() => loadStr(NAME_KEY));
  const [funktion, setFunktion] = useState(() => loadStr(FUNKTION_KEY));
  const [betrieb, setBetrieb] = useState(() => loadStr(BETRIEB_KEY));
  const [nachname, setNachname] = useState(() => loadStr(NACHNAME_KEY));
  const [showTags, setShowTags] = useState(() => loadBool(SHOW_TAGS_KEY, true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [model, setModel] = useState<ReportModel | null>(null);

  const persistSettings = () => {
    saveStr(NAME_KEY, name);
    saveStr(FUNKTION_KEY, funktion);
    saveStr(BETRIEB_KEY, betrieb);
    saveStr(NACHNAME_KEY, nachname);
    saveBool(SHOW_TAGS_KEY, showTags);
  };

  const buildReport = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const { buildReportModel } = await import("../export/reportPdf");
      const range = mode === "monat" ? monthRangeFromValue(month) : { from, to };
      const entries = await listEntries({
        from: range.from || undefined,
        to: range.to || undefined,
      });
      setModel(
        buildReportModel(entries, (e) => e.tagLabels.join(", "), {
          name,
          from: range.from,
          to: range.to,
          funktion,
          betrieb,
          nachname,
          showTags,
        })
      );
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doPrint = () => {
    persistSettings();
    window.print();
  };

  const doSavePdf = async () => {
    if (!model) return;
    persistSettings();
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
          <div>
            <span className="mb-1 block text-sm text-secondary-ink">
              Zeitraum
            </span>
            <SegmentedControl
              options={MODE_OPTIONS}
              value={mode}
              onChange={setMode}
            />
            <div className="mt-2 flex items-end gap-2">
              {mode === "monat" ? (
                <label className="flex-1 text-sm text-secondary-ink">
                  Monat
                  <input
                    type="month"
                    className={field}
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm text-secondary-ink">
            Funktion
            <input
              className={field}
              value={funktion}
              onChange={(e) => setFunktion(e.target.value)}
              placeholder="z. B. BR-Vorsitzender"
            />
          </label>
          <label className="text-sm text-secondary-ink">
            Betrieb/Firma
            <input
              className={field}
              value={betrieb}
              onChange={(e) => setBetrieb(e.target.value)}
              placeholder="z. B. Musterwerk GmbH"
            />
          </label>
          <label className="text-sm text-secondary-ink">
            Nachname für Dateinamen
            <input
              className={field}
              value={nachname}
              onChange={(e) => setNachname(e.target.value)}
              placeholder="z. B. König"
            />
          </label>
        </div>

        <label className="mt-3 flex min-h-touch-pointer items-center gap-2 text-sm text-secondary-ink">
          <input
            type="checkbox"
            checked={showTags}
            onChange={(e) => setShowTags(e.target.checked)}
          />
          Schlagwörter im Report
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-touch rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50 sm:min-h-0"
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
              {/* Task 3: Funktion/Betrieb (headerExtras, Task 2) waren bislang
                  nur im PDF sichtbar, nicht in dieser Vorschau -- ohne diese
                  Zeilen hätten die neuen Felder oben keine sichtbare Wirkung
                  auf dem Bildschirm, nur im gespeicherten PDF. */}
              {model.headerExtras.map((h) => (
                <tr key={h.label}>
                  <td>{h.label}</td>
                  <td>{h.value}</td>
                </tr>
              ))}
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
              {/* Task 3b: dayRows (statt rows) -- sonst fehlten die
                  Tagessummen-Zeilen, die das PDF (toAutoTableInput) an
                  derselben Stelle bereits zeigt (nach dem letzten Eintrag
                  jedes Kalendertags). Spaltenanzahl je Zeilenart bleibt an
                  showTags gekoppelt (wie entryRowCells in reportPdf.ts) --
                  sonst hätte die Kopfzeile bei showTags=false eine Spalte
                  weniger als jede Datenzeile. */}
              {model.dayRows.map((r, i) =>
                r.kind === "entry" ? (
                  <tr key={i}>
                    <td style={cellStyle}>{r.row.date}</td>
                    <td style={cellStyle}>{r.row.start}</td>
                    <td style={cellStyle}>{r.row.end}</td>
                    <td style={cellStyle}>{r.row.pause}</td>
                    <td style={cellStyle}>{r.row.duration}</td>
                    {model.showTags && <td style={cellStyle}>{r.row.tags}</td>}
                    <td style={cellStyle}>{r.row.info}</td>
                    <td style={cellStyle}>{r.row.shift}</td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td
                      style={cellStyle}
                      colSpan={model.columns.length}
                      className="bg-surface-2 font-medium"
                    >
                      {r.label}
                    </td>
                  </tr>
                )
              )}
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

          {/* Task 3b: objectionLines (Task 2) waren bislang nur im PDF
              sichtbar (renderReportPdf druckt "Widersprüche der
              Geschäftsleitung" + Zeilen), nicht in dieser Vorschau --
              Reihenfolge/Überschrift exakt wie im PDF-Renderer. */}
          {model.objectionLines.length > 0 && (
            <div style={{ fontSize: "9pt", marginTop: 8 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>
                Widersprüche der Geschäftsleitung
              </p>
              {model.objectionLines.map((line, i) => (
                <p key={i} style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
            </div>
          )}

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
