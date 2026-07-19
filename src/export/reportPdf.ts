// PDF-Nachweis (Linux-Portierung, L5). Bisher (Windows) reichte der
// Systemdruckdialog von WebView2 (inkl. "Als PDF speichern") für den
// druckbaren Monatsnachweis -- unter WebKitGTK/Linux ist der Druckpfad
// unzuverlässig, unter Android fehlt er ganz (siehe PrintReportPanel.tsx).
// Deshalb hier ein plattformunabhängiger PDF-Renderer via jsPDF/autotable,
// der dieselben Daten wie die HTML-Vorschau nutzt.
//
// Modell/Render-Trennung nach dem Muster von toCsv.ts: `buildReportModel`
// ist eine reine Funktion (Daten -> Modell), `renderReportPdf` ist der
// einzige Ort, der jsPDF anfasst. Die HTML-Vorschau in PrintReportPanel.tsx
// speist sich aus genau demselben Modell -- Vorschau und PDF können dadurch
// nicht auseinanderlaufen.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntryListItem } from "../types";
import { minutesToHhmm } from "../lib/time";
import { formatDateDe, todayIso } from "../lib/calendar";
import { PRINT } from "../lib/tokens";

export interface ReportOpts {
  name: string;
  from: string; // YYYY-MM-DD oder "" (= "Anfang")
  to: string; // YYYY-MM-DD oder "" (= "Ende")
  /** Nur für Tests: fester "Erstellt am"-Stempel statt todayIso(). */
  createdAt?: string;
}

export interface ReportRow {
  date: string; // bereits deutsch formatiert (formatDateDe)
  start: string;
  end: string;
  pause: string; // Pause in Minuten als String, "0" ohne Pause (Konsistenz mit CSV-Export)
  duration: string; // "H:MM"
  tags: string;
  info: string;
  shift: string; // "ja" | "nein" -- geplante Schicht (Finding-Parallele zur CSV-Spalte)
}

export interface ReportModel {
  title: string;
  name: string;
  periodLabel: string;
  createdAtLabel: string;
  columns: string[];
  rows: ReportRow[];
  totalLabel: string;
  totalValue: string;
  compensationLabel: string;
  signatureLabels: [string, string, string];
  /** Dateiname ohne Endung, z. B. "BR-Nachweis_2026-06-01_bis_2026-06-30". */
  fileBaseName: string;
}

const COLUMNS = [
  "Datum",
  "Von",
  "Bis",
  "Pause (Min)",
  "Dauer",
  "Schlagwörter",
  "Info für Geschäftsleitung",
  "Geplante Schicht",
];

const SIGNATURE_LABELS: [string, string, string] = [
  "Datum",
  "Unterschrift BR-Mitglied",
  "Unterschrift Geschäftsleitung",
];

function fileBaseName(from: string, to: string): string {
  if (from || to) {
    return `BR-Nachweis_${from || "Anfang"}_bis_${to || "Ende"}`;
  }
  return `BR-Nachweis_${todayIso()}`;
}

/**
 * Baut das Berichtsmodell aus den (bereits GL-tauglich geladenen, d. h. ohne
 * secretDetails) Einträgen. Übernimmt die Spaltenlogik/Trennung der
 * bisherigen Druck-Vorschau: Freizeitausgleich-Einträge sind keine
 * BR-Tätigkeit und laufen NICHT in die Zeilen/Summe der Arbeitszeit-Tabelle
 * ein, sondern in eine eigene Zusammenfassungszeile.
 *
 * `tagLabels` ist bewusst ein Projektor (Entry -> Anzeigetext) statt eines
 * hart einprogrammierten `e.tagLabels.join(", ")`: dieselbe Idee wie
 * `CsvColumn.value` in toCsv.ts (siehe dortiger Kopfkommentar "weitere
 * Formatter können dieselben Spaltendefinitionen nutzen") -- hält das Modell
 * unabhängig von einer festen Trennzeichen-Konvention und leicht testbar.
 */
export function buildReportModel(
  entries: EntryListItem[],
  tagLabels: (entry: EntryListItem) => string,
  opts: ReportOpts
): ReportModel {
  const sorted = [...entries].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const workEntries = sorted.filter((e) => !e.isCompensation);
  const compensationEntries = sorted.filter((e) => e.isCompensation);

  const totalMinutes = workEntries.reduce((s, e) => s + e.durationMinutes, 0);
  const compensationMinutes = compensationEntries.reduce(
    (s, e) => s + e.durationMinutes,
    0
  );

  const rows: ReportRow[] = workEntries.map((e) => ({
    date: formatDateDe(e.date),
    start: e.startTime ?? "",
    end: e.endTime ?? "",
    pause: String(e.pauseMinutes),
    duration: minutesToHhmm(e.durationMinutes),
    tags: tagLabels(e),
    info: e.infoForManagement,
    shift: e.hadPlannedShift ? "ja" : "nein",
  }));

  const periodLabel = `${opts.from ? formatDateDe(opts.from) : "Anfang"} – ${
    opts.to ? formatDateDe(opts.to) : "Ende"
  }`;

  const compensationLabel =
    compensationEntries.length > 0
      ? `${minutesToHhmm(compensationMinutes)} Std an ${
          compensationEntries.length
        } Tag(en) (${compensationEntries
          .map((e) => formatDateDe(e.date))
          .join(", ")})`
      : "keiner.";

  return {
    title: "Nachweis Betriebsratszeiten",
    name: opts.name.trim() || "—",
    periodLabel,
    createdAtLabel: formatDateDe(opts.createdAt ?? todayIso()),
    columns: COLUMNS,
    rows,
    totalLabel: "Summe",
    totalValue: `${minutesToHhmm(totalMinutes)} Std`,
    compensationLabel,
    signatureLabels: SIGNATURE_LABELS,
    fileBaseName: fileBaseName(opts.from, opts.to),
  };
}

/**
 * Reine Übersetzung des Modells in die {head, body}-Struktur, die
 * jspdf-autotable erwartet. Eigenständig exportiert, damit Tests die
 * Spalten-/Zeilenstruktur ohne echtes PDF-Rendering prüfen können.
 */
export function toAutoTableInput(model: ReportModel): {
  head: string[][];
  body: string[][];
} {
  return {
    head: [model.columns],
    body: model.rows.map((r) => [
      r.date,
      r.start,
      r.end,
      r.pause,
      r.duration,
      r.tags,
      r.info,
      r.shift,
    ]),
  };
}

const PAGE_MARGIN = 14; // mm

/**
 * Rendert das Modell zu PDF-Bytes (A4 hochkant). Deutsche Umlaute laufen über
 * die eingebaute WinAnsi-Kodierung der jsPDF-Standardfonts (Helvetica) --
 * kein Font-Embedding nötig. Paginierung übernimmt autotable; der Seitenfuß
 * mit Seitenzahl wird NACH dem Tabellenaufbau in einem zweiten Durchlauf über
 * alle bereits erzeugten Seiten gesetzt (die Gesamtseitenzahl steht erst dann
 * fest).
 */
export function renderReportPdf(model: ReportModel): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = 18;
  doc.setFontSize(16);
  doc.text(model.title, PAGE_MARGIN, y);
  y += 9;

  doc.setFontSize(10);
  doc.text(`Name: ${model.name}`, PAGE_MARGIN, y);
  y += 5;
  doc.text(`Zeitraum: ${model.periodLabel}`, PAGE_MARGIN, y);
  y += 5;
  doc.text(`Erstellt am: ${model.createdAtLabel}`, PAGE_MARGIN, y);
  y += 6;

  const { head, body } = toAutoTableInput(model);
  autoTable(doc, {
    head,
    body,
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8.5, cellPadding: 1.5 },
    headStyles: { fillColor: PRINT.headerBg }, // slate-600 (tokens.ts)
    columnStyles: {
      0: { cellWidth: 22 }, // Datum
      1: { cellWidth: 13 }, // Von
      2: { cellWidth: 13 }, // Bis
      3: { cellWidth: 15 }, // Pause (Min)
      4: { cellWidth: 15 }, // Dauer
      5: { cellWidth: 30 }, // Schlagwörter
      7: { cellWidth: 22 }, // Geplante Schicht
      // Spalte 6 (Info für Geschäftsleitung) bleibt "auto" -- nimmt den Rest.
    },
  });

  // finalY steht erst nach dem autoTable-Aufruf zur Verfügung.
  let afterTableY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 8;

  const neededForFooterBlock = 8 + 24; // Freizeitausgleich-Zeile + Unterschriftsfelder
  if (afterTableY + neededForFooterBlock > pageHeight - PAGE_MARGIN) {
    doc.addPage();
    afterTableY = 18;
  }

  doc.setFontSize(9);
  doc.text(
    `Freizeitausgleich in diesem Zeitraum: ${model.compensationLabel}`,
    PAGE_MARGIN,
    afterTableY,
    { maxWidth: pageWidth - 2 * PAGE_MARGIN }
  );

  const sigY = afterTableY + 24;
  const colWidth = (pageWidth - 2 * PAGE_MARGIN - 2 * 8) / 3;
  model.signatureLabels.forEach((label, i) => {
    const x = PAGE_MARGIN + i * (colWidth + 8);
    doc.line(x, sigY, x + colWidth, sigY);
    doc.text(label, x, sigY + 4);
  });

  // Seitenfuß mit Seitenzahl -- über ALLE mittlerweile feststehenden Seiten.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(PRINT.footerMuted);
    doc.text(`Seite ${i} von ${pageCount}`, pageWidth - PAGE_MARGIN, pageHeight - 8, {
      align: "right",
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

/**
 * Base64-Kodierung für den `export_binary_file`-Command (Tauri-IPC-Argumente
 * sind JSON, daher Base64 statt roher Bytes -- siehe Kommentar in
 * src-tauri/src/file_io.rs). In Chunks kodiert, damit
 * `String.fromCharCode(...bytes)` bei großen PDFs nicht am
 * Aufrufstack-Limit scheitert.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
