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
//
// Issue #16 (unterschriftsfähiger GL-Monatsnachweis, Task 2/3): das Modell
// bekommt zusätzlich Tagessummen (`dayRows`), eine Widerspruchs-Kennzeichnung
// (Datums-Suffix + eigener Block, Daten aus `GlEntryView.objections`), zwei
// statt drei Unterschriftsfelder und einen an Monats-/Zeitraum-Modus sowie
// Nachname gekoppelten Dateinamen. `funktion`/`betrieb`/`nachname`/`showTags`
// waren in Task 2 übergangsweise OPTIONAL in `ReportOpts` (mit Defaults),
// damit PrintReportPanel.tsx (verdrahtet erst in Task 3) kompilierbar blieb,
// ohne dass dieser Task dort schon Hand anlegen musste. Seit Task 3 reicht
// PrintReportPanel.tsx alle vier Werte durch -- die Felder sind deshalb
// wieder PFLICHTFELDER (kein `?`); der einzige verbleibende Default liegt in
// der UI (React-State/localStorage), nicht mehr im Modell-Builder.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntryListItem } from "../types";
import { minutesToHhmm } from "../lib/time";
import { formatDateDe, todayIso } from "../lib/calendar";
import { PRINT } from "../lib/tokens";
import { glEntryView, type GlEntryView } from "./glProjection";

export interface ReportOpts {
  name: string;
  from: string; // YYYY-MM-DD oder "" (= "Anfang")
  to: string; // YYYY-MM-DD oder "" (= "Ende")
  /** Nur für Tests: fester "Erstellt am"-Stempel statt todayIso(). */
  createdAt?: string;
  /** Kopfzeile "Funktion: …" -- weggelassen, wenn leer (nach trim()). */
  funktion: string;
  /** Kopfzeile "Betrieb/Firma: …" -- weggelassen, wenn leer (nach trim()). */
  betrieb: string;
  /** Nachname für den Dateinamen (siehe fileBaseName) -- KEIN Kopfzeilenfeld. */
  nachname: string;
  /** Schlagwörter-Spalte anzeigen. */
  showTags: boolean;
}

export interface ReportRow {
  date: string; // bereits deutsch formatiert (formatDateDe), ggf. mit " *"-Suffix bei Widerspruch (Legende: OBJECTION_LEGEND, erste Zeile von ReportModel.objectionLines)
  start: string;
  end: string;
  pause: string; // Pause in Minuten als String, "0" ohne Pause (Konsistenz mit CSV-Export)
  duration: string; // "H:MM"
  tags: string;
  info: string;
  shift: string; // "ja" | "nein" -- geplante Schicht (Finding-Parallele zur CSV-Spalte)
}

/** Eine zusätzliche, optionale Kopfzeile (Funktion/Betrieb) -- leer = weggelassen. */
export interface ReportHeaderLine {
  label: string;
  value: string;
}

/**
 * Eine Zeile der Tabelle, wie sie tatsächlich gerendert wird: entweder ein
 * Eintrag (`row`, identisch zu den Objekten in `ReportModel.rows`) oder die
 * Tagessummen-Zeile "Summe TT.MM.JJJJ — H:MM", die nach den Einträgen eines
 * Kalendertags eingefügt wird. Eigener Unions-Typ statt Wiederverwendung von
 * `ReportRow` mit Leerspalten -- eine Summenzeile hat konzeptionell keine
 * Von/Bis/Pause/etc.-Werte und soll in `toAutoTableInput` als EINE über alle
 * Spalten gespannte Zelle landen, kein 8-spaltiges Zeilenformat mit
 * Blindwerten.
 */
export type ReportTableRow =
  | { kind: "entry"; row: ReportRow }
  | { kind: "day-summary"; label: string };

export interface ReportModel {
  title: string;
  name: string;
  periodLabel: string;
  createdAtLabel: string;
  /** Zusätzliche Kopfzeilen (Funktion/Betrieb) -- leer, wenn beide leer sind. */
  headerExtras: ReportHeaderLine[];
  columns: string[];
  /** Ob die Schlagwörter-Spalte in `columns`/den Tabellenzeilen enthalten ist. */
  showTags: boolean;
  /** Reine Eintragszeilen, sortiert nach Datum -- OHNE Tagessummen (Bestand). */
  rows: ReportRow[];
  /**
   * Eintragszeilen UND Tagessummen-Zeilen in Render-Reihenfolge (nach jedem
   * Kalendertag folgt dessen Summenzeile). Das ist die Eingabe für
   * `toAutoTableInput` -- `rows` bleibt daneben bestehen, weil es die
   * Bestandsschnittstelle für Konsumenten ist, die nur die reinen Einträge
   * brauchen (z. B. eine künftige Vorschau ohne Tagessummen).
   */
  dayRows: ReportTableRow[];
  totalLabel: string;
  totalValue: string;
  compensationLabel: string;
  /**
   * Widerspruchs-Block: bei mindestens einem Widerspruch steht als ERSTE
   * Zeile die Legende `OBJECTION_LEGEND` ("* = Eintrag mit Widerspruch" --
   * erklärt das " *"-Suffix in `ReportRow.date`, siehe dort), gefolgt von
   * "TT.MM.JJJJ — Begründung (Name)" je Widerspruch, aus
   * `GlEntryView.objections` aller Arbeitszeit-Einträge zusammengetragen
   * (Reihenfolge = Zeilenreihenfolge). Leer = kein Block im PDF (auch keine
   * Legende, dann bräuchte sie niemand).
   */
  objectionLines: string[];
  /**
   * Zwei Unterschriftsfelder (Betriebsratsmitglied, Geschäftsleitung/
   * Vorgesetzte:r) -- ersetzt die bisherigen drei Linien (Datum getrennt von
   * den beiden Unterschriften). Jedes Feld trägt seine eigene "Datum,
   * Unterschrift"-Beschriftung samt Rollenname in einem String, damit
   * PrintReportPanel.tsx (Task 3) ohne Anpassung weiter über
   * `.map(label => ...)` rendern kann.
   */
  signatureLabels: [string, string];
  /** Dateiname ohne Endung, z. B. "BR-Stundennachweis_2026-06_König". */
  fileBaseName: string;
}

function buildColumns(showTags: boolean): string[] {
  return [
    "Datum",
    "Von",
    "Bis",
    "Pause (Min)",
    "Dauer",
    ...(showTags ? ["Schlagwörter"] : []),
    "Info für Geschäftsleitung",
    "Geplante Schicht",
  ];
}

const SIGNATURE_LABELS: [string, string] = [
  "Datum, Unterschrift Betriebsratsmitglied",
  "Datum, Unterschrift Geschäftsleitung/Vorgesetzte:r",
];

/**
 * Erste Zeile des Widerspruchs-Blocks, erklärt das " *"-Suffix in der
 * Datums-Zelle. War ursprünglich "⚠" (U+26A0) statt " *" -- das schaltet
 * jsPDF-intern von WinAnsi auf UTF-16BE um, während die Helvetica-
 * Standardfonts WinAnsi-kodiert bleiben: alle Zeichen NACH dem Suffix
 * wurden dadurch zu Zeichensalat (Finding C2, empirisch belegt). Ein reines
 * ASCII-Suffix plus dieser Legende vermeidet das.
 */
const OBJECTION_LEGEND = "* = Eintrag mit Widerspruch";

/** ISO (YYYY-MM-DD) -> "TT.MM.JJJJ", OHNE Wochentag (Unterschied zu formatDateDe). */
function formatDateDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Zeichen, die in Windows/Linux/Android-Dateinamen verboten oder problematisch sind. */
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/**
 * Prüft, ob `from`..`to` exakt einen vollen Kalendermonat abdeckt (from = 1.
 * des Monats, to = letzter Tag desselben Monats) -- Grundlage für den
 * Monatsmodus-Dateinamen. `new Date(year, month, 0).getDate()` ist der
 * Standard-Trick für "Tage im Monat `month`" bei 1-basiertem `month`: Tag 0
 * des (0-basiert um eins höheren) Folgemonats ist der letzte Tag des
 * gesuchten Monats.
 */
function isFullCalendarMonth(from: string, to: string): boolean {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy !== ty || fm !== tm || fd !== 1) return false;
  const daysInMonth = new Date(fy, fm, 0).getDate();
  return td === daysInMonth;
}

/**
 * Dateiname (ohne Endung): Monatsmodus -> "BR-Stundennachweis_JJJJ-MM[_Nachname]";
 * freier Zeitraum -> "BR-Stundennachweis_JJJJ-MM-TT_bis_JJJJ-MM-TT[_Nachname]";
 * kein Zeitraum gewählt -> "BR-Stundennachweis_<heute>[_Nachname]". Ohne
 * Nachname entfällt das Suffix samt Unterstrich vollständig. Nachname wird
 * NICHT auf ASCII beschränkt (Umlaute bleiben erhalten) -- nur die für
 * Dateisysteme kritischen Zeichen `/\:*?"<>|` werden durch "-" ersetzt.
 */
function fileBaseName(from: string, to: string, nachname: string): string {
  const sanitized = nachname.trim().replace(UNSAFE_FILENAME_CHARS, "-");
  const suffix = sanitized ? `_${sanitized}` : "";

  if (from && to && isFullCalendarMonth(from, to)) {
    return `BR-Stundennachweis_${from.slice(0, 7)}${suffix}`;
  }
  if (from || to) {
    return `BR-Stundennachweis_${from || "Anfang"}_bis_${to || "Ende"}${suffix}`;
  }
  return `BR-Stundennachweis_${todayIso()}${suffix}`;
}

/** "TT.MM.JJJJ — Begründung (Name)"; "ohne Datum", wenn das Widerspruchsdatum fehlt. */
function formatObjectionLine(o: { reason: string; byWhom: string; date: string | null }): string {
  const dateLabel = o.date ? formatDateDdMmYyyy(o.date) : "ohne Datum";
  return `${dateLabel} — ${o.reason} (${o.byWhom})`;
}

/**
 * Gruppiert die (bereits nach Datum sortierten) Arbeitszeit-Einträge und ihre
 * fertig gebauten Zeilen zu der Render-Reihenfolge aus `ReportModel.dayRows`:
 * nach den Einträgen jedes Kalendertags folgt dessen Summenzeile. `entries`
 * und `rows` sind parallele Arrays (gleicher Index = derselbe Eintrag) --
 * die Tagessumme wird aus den ROHEN Minuten (`durationMinutes`) gebildet,
 * nicht aus den bereits formatierten "H:MM"-Strings, damit keine
 * Rundungs-/Parsing-Differenz zur Gesamtsumme entstehen kann.
 */
function buildDayRows(entries: EntryListItem[], rows: ReportRow[]): ReportTableRow[] {
  const result: ReportTableRow[] = [];
  let i = 0;
  while (i < entries.length) {
    const date = entries[i].date;
    let dayMinutes = 0;
    while (i < entries.length && entries[i].date === date) {
      result.push({ kind: "entry", row: rows[i] });
      dayMinutes += entries[i].durationMinutes;
      i++;
    }
    result.push({
      kind: "day-summary",
      label: `Summe ${formatDateDdMmYyyy(date)} — ${minutesToHhmm(dayMinutes)}`,
    });
  }
  return result;
}

/**
 * Baut das Berichtsmodell aus den (bereits GL-tauglich geladenen, d. h. ohne
 * secretDetails) Einträgen. Die Zeilen (ReportRow) lesen ausschließlich aus
 * glEntryView(e) -- dieselbe Projektion wie die GL-CSV (exporters.ts
 * publicColumns), siehe glProjection.ts (Issue #16: kein zweiter, parallel
 * gepflegter Feld-Filter). Übernimmt die Spaltenlogik/Trennung der
 * bisherigen Druck-Vorschau: Freizeitausgleich-Einträge sind keine
 * BR-Tätigkeit und laufen NICHT in die Zeilen/Summe der Arbeitszeit-Tabelle
 * ein, sondern in eine eigene Zusammenfassungszeile.
 *
 * `tagLabels` ist bewusst ein Projektor (GlEntryView -> Anzeigetext) statt
 * eines hart einprogrammierten `view.tagLabels.join(", ")`: dieselbe Idee wie
 * `CsvColumn.value` in toCsv.ts (siehe dortiger Kopfkommentar "weitere
 * Formatter können dieselben Spaltendefinitionen nutzen") -- hält das Modell
 * unabhängig von einer festen Trennzeichen-Konvention und leicht testbar.
 * Bekommt bewusst die GlEntryView (NICHT das rohe `EntryListItem`, Finding
 * M1): sonst würde ausgerechnet diese eine Spalte NICHT mehr ausschließlich
 * aus `glEntryView(e)` lesen wie der Rest der Zeile.
 */
export function buildReportModel(
  entries: EntryListItem[],
  tagLabels: (view: GlEntryView) => string,
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

  const showTags = opts.showTags;
  const columns = buildColumns(showTags);

  const rows: ReportRow[] = workEntries.map((e) => {
    const view = glEntryView(e);
    const dateLabel =
      formatDateDe(view.date) + (view.objections.length > 0 ? " *" : "");
    return {
      date: dateLabel,
      start: view.startTime ?? "",
      end: view.endTime ?? "",
      pause: String(view.pauseMinutes),
      duration: minutesToHhmm(view.durationMinutes),
      tags: tagLabels(view),
      info: view.infoForManagement,
      shift: view.hadPlannedShift ? "ja" : "nein",
    };
  });

  const dayRows = buildDayRows(workEntries, rows);

  const objectionDetailLines = workEntries.flatMap(
    (e) => glEntryView(e).objections.map(formatObjectionLine)
  );
  // Legende nur voranstellen, wenn es überhaupt einen Widerspruch gibt --
  // sonst gäbe es einen Ein-Zeilen-"Block" ohne jeden Widerspruch darunter.
  const objectionLines =
    objectionDetailLines.length > 0
      ? [OBJECTION_LEGEND, ...objectionDetailLines]
      : [];

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

  const headerExtras: ReportHeaderLine[] = [];
  if (opts.funktion.trim()) {
    headerExtras.push({ label: "Funktion", value: opts.funktion.trim() });
  }
  if (opts.betrieb.trim()) {
    headerExtras.push({ label: "Betrieb/Firma", value: opts.betrieb.trim() });
  }

  return {
    title: "Nachweis Betriebsratszeiten",
    name: opts.name.trim() || "—",
    periodLabel,
    createdAtLabel: formatDateDe(opts.createdAt ?? todayIso()),
    headerExtras,
    columns,
    showTags,
    rows,
    dayRows,
    totalLabel: "Summe",
    totalValue: `${minutesToHhmm(totalMinutes)} Std`,
    compensationLabel,
    objectionLines,
    signatureLabels: SIGNATURE_LABELS,
    fileBaseName: fileBaseName(opts.from, opts.to, opts.nachname),
  };
}

/** autotable-Zellenformat für eine Eintragszeile, in exakt der Spaltenreihenfolge von `columns`. */
function entryRowCells(r: ReportRow, showTags: boolean): string[] {
  const cells = [r.date, r.start, r.end, r.pause, r.duration];
  if (showTags) cells.push(r.tags);
  cells.push(r.info, r.shift);
  return cells;
}

/**
 * Reine Übersetzung des Modells in die {head, body}-Struktur, die
 * jspdf-autotable erwartet. Eigenständig exportiert, damit Tests die
 * Spalten-/Zeilenstruktur ohne echtes PDF-Rendering prüfen können.
 * Tagessummen-Zeilen werden als EINE über alle Spalten gespannte Zelle
 * (`colSpan`) kodiert -- jspdf-autotable akzeptiert das nativ als eigene
 * `RowInput` mit nur einem `CellDef`.
 */
export function toAutoTableInput(model: ReportModel): {
  head: string[][];
  body: (string | { content: string; colSpan: number })[][];
  /**
   * Fußzeile mit der Monatssumme, eine über alle Spalten gespannte Zelle
   * (Finding C1: `totalLabel`/`totalValue` standen bislang nur im Modell,
   * ohne je gedruckt zu werden -- die Vorschau zeigt dieselbe Summe in ihrem
   * `<tfoot>`, siehe PrintReportPanel.tsx).
   */
  foot: (string | { content: string; colSpan: number })[][];
} {
  return {
    head: [model.columns],
    body: model.dayRows.map((r) =>
      r.kind === "entry"
        ? entryRowCells(r.row, model.showTags)
        : [{ content: r.label, colSpan: model.columns.length }]
    ),
    foot: [
      [
        {
          content: `${model.totalLabel}: ${model.totalValue}`,
          colSpan: model.columns.length,
        },
      ],
    ],
  };
}

/**
 * Reine Berechnung für den Widerspruchs-Block im PDF-Footer (Finding I2):
 * bricht jede Zeile aus `objectionLines` einzeln um (via injizierter
 * `splitToLines`, damit die Funktion ohne echtes jsPDF-Dokument testbar
 * bleibt -- die tatsächliche Zeilenbreite hängt von Font/Fontgröße ab, die
 * nur ein echtes Dokument kennt) und liefert sowohl die flache Liste ALLER
 * Druckzeilen (Reihenfolge = Eingabereihenfolge, jede Eingabezeile kann zu
 * mehreren Ausgabezeilen werden) als auch die daraus resultierende
 * Blockhöhe in mm (Überschrift + `printLines.length * 5` + Nachlaufabstand).
 * Dieselbe Zeilenanzahl fließt in BEIDE Werte ein, damit die
 * Seitenumbruch-Schätzung (`neededForFooterBlock` in renderReportPdf) nie
 * von der tatsächlich gedruckten Höhe abweicht -- vorher nahm die Schätzung
 * pauschal eine Druckzeile pro Widerspruch an, obwohl `doc.text(..., {
 * maxWidth })` lange Begründungen intern umbricht, ohne die Y-Position
 * entsprechend mitzuführen (Zeilen überlappten sich sichtbar).
 */
export function buildObjectionsBlockLayout(
  objectionLines: string[],
  splitToLines: (line: string) => string[]
): { printLines: string[]; blockHeight: number } {
  if (objectionLines.length === 0) return { printLines: [], blockHeight: 0 };
  const printLines = objectionLines.flatMap((line) => splitToLines(line));
  const blockHeight = 6 + printLines.length * 5 + 2;
  return { printLines, blockHeight };
}

const PAGE_MARGIN = 14; // mm

/** mm-Spaltenbreiten je Spaltenbeschriftung -- indexunabhängig, damit `showTags:false` (weniger Spalten) keine hartkodierten Positionen verschiebt. Spalte "Info für Geschäftsleitung" bleibt bewusst ohne Eintrag ("auto" -- nimmt den Rest). */
const COLUMN_WIDTHS_MM: Record<string, number> = {
  Datum: 22,
  Von: 13,
  Bis: 13,
  "Pause (Min)": 15,
  Dauer: 15,
  Schlagwörter: 30,
  "Geplante Schicht": 22,
};

function buildColumnStyles(columns: string[]): Record<number, { cellWidth: number }> {
  const styles: Record<number, { cellWidth: number }> = {};
  columns.forEach((col, i) => {
    const width = COLUMN_WIDTHS_MM[col];
    if (width !== undefined) styles[i] = { cellWidth: width };
  });
  return styles;
}

/**
 * Rendert das Modell zu PDF-Bytes (A4 hochkant). Deutsche Umlaute laufen über
 * die eingebaute WinAnsi-Kodierung der jsPDF-Standardfonts (Helvetica) --
 * kein Font-Embedding nötig. Paginierung übernimmt autotable; der Seitenfuß
 * mit Seitenzahl wird NACH dem Tabellenaufbau in einem zweiten Durchlauf über
 * alle bereits erzeugten Seiten gesetzt (die Gesamtseitenzahl steht erst dann
 * fest).
 *
 * Pagination-Entscheidung (Tagessummen, Selbst-Review Task 2): im
 * jspdf-autotable-Quelltext (shouldPrintOnCurrentPage/printFullRow,
 * node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.js) nachgesehen
 * statt vermutet -- der DEFAULT `rowPageBreak: "auto"` kann den Inhalt einer
 * zu hohen Zeile (z. B. ein stark umbrechender "Info für
 * Geschäftsleitung"-Text) mitten durchschneiden und auf zwei Seiten
 * verteilen. Deshalb hier explizit `rowPageBreak: "avoid"`: jede Zeile
 * (Eintrag WIE Tagessummen-Zeile) wird als Ganzes entweder auf die aktuelle
 * oder komplett auf die nächste Seite gesetzt, nie mittendrin geteilt. Was
 * das NICHT verhindert: dass eine Tagessummen-Zeile auf eine ANDERE Seite
 * rutscht als die letzten Einträge desselben Tages (jspdf-autotable kennt
 * kein zeilenübergreifendes "bleib zusammen", nur pro-Zeile-Regeln) --
 * analog zu Zwischensummen in mehrseitigen Rechnungen und bei den hier
 * üblichen wenigen Tageszeilen ein seltener Randfall, der bewusst nicht
 * durch eine eigene Gruppierungslogik zusätzlich erzwungen wird.
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
  y += 5;
  model.headerExtras.forEach(({ label, value }) => {
    doc.text(`${label}: ${value}`, PAGE_MARGIN, y);
    y += 5;
  });
  y += 1; // Abstand vor der Tabelle (entspricht dem bisherigen "+6" nach der letzten Kopfzeile)

  const { head, body, foot } = toAutoTableInput(model);
  autoTable(doc, {
    head,
    body,
    foot,
    // "lastPage" statt des Default ("everyPage"): die Monatssumme ist ein
    // EINMALIGER Gesamtwert, kein Seiten-Zwischenstand -- sie soll deshalb
    // nur einmal erscheinen, direkt unter der letzten Tabellenzeile (genau
    // dort, wo auch die Vorschau ihr <tfoot> zeigt), nicht auf jeder Seite
    // erneut (Finding C1).
    showFoot: "lastPage",
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8.5, cellPadding: 1.5 },
    headStyles: { fillColor: PRINT.headerBg }, // slate-600 (tokens.ts)
    footStyles: { fontStyle: "bold" },
    columnStyles: buildColumnStyles(model.columns),
    rowPageBreak: "avoid", // siehe Pagination-Kommentar oben (Tagessummen/Selbst-Review)
  });

  // finalY steht erst nach dem autoTable-Aufruf zur Verfügung.
  let afterTableY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 8;

  // Ab hier gilt 9pt für Freizeitausgleich-Zeile und Widerspruchs-Block --
  // VOR der Höhenschätzung gesetzt (nicht erst kurz vor dem Druck), damit
  // `buildObjectionsBlockLayout` unten mit derselben Fontgröße umbricht, mit
  // der später tatsächlich gedruckt wird (Finding I2: die Schätzung muss zur
  // Druckgröße passen, sonst weicht sie wieder von der echten Höhe ab).
  doc.setFontSize(9);

  const objectionsWidth = pageWidth - 2 * PAGE_MARGIN;
  const objectionsLayout = buildObjectionsBlockLayout(model.objectionLines, (line) =>
    doc.splitTextToSize(line, objectionsWidth)
  );

  // Grobe Höhenschätzung für Freizeitausgleich-Zeile + optionalen
  // Widerspruchs-Block + Unterschriftsfelder -- analog zur bisherigen
  // Heuristik (kein exaktes Text-Measuring, siehe Kommentar oben zu
  // "avoid"/"auto"). Bei sehr vielen (oder sehr langen) Widersprüchen kann
  // der Block dennoch über die Seite hinausragen; das teilt die bisherige
  // Vereinfachung dieses Blocks (kein Mehrseiten-Fließtext-Layout für den
  // Footer) -- `objectionsLayout.blockHeight` beruht aber jetzt auf der
  // tatsächlichen (umgebrochenen) Druckzeilenzahl statt pauschal einer Zeile
  // je Widerspruch (Finding I2).
  const neededForFooterBlock = 8 + objectionsLayout.blockHeight + 24;
  if (afterTableY + neededForFooterBlock > pageHeight - PAGE_MARGIN) {
    doc.addPage();
    afterTableY = 18;
  }

  doc.text(
    `Freizeitausgleich in diesem Zeitraum: ${model.compensationLabel}`,
    PAGE_MARGIN,
    afterTableY,
    { maxWidth: objectionsWidth }
  );

  let footerY = afterTableY + 8;
  if (model.objectionLines.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.text("Widersprüche der Geschäftsleitung", PAGE_MARGIN, footerY);
    doc.setFont("helvetica", "normal");
    footerY += 5;
    // `printLines` ist bereits auf `objectionsWidth` umgebrochen (siehe
    // buildObjectionsBlockLayout oben) -- kein `maxWidth` mehr nötig, UND
    // footerY wandert um `printLines.length * 5` statt um einer Zeile je
    // Widerspruch mit, sonst überlappten sich Folgezeilen langer
    // Begründungen (Finding I2).
    objectionsLayout.printLines.forEach((line) => {
      doc.text(line, PAGE_MARGIN, footerY);
      footerY += 5;
    });
    footerY += 2;
  }

  const sigY = footerY + 20;
  const gapCount = model.signatureLabels.length - 1;
  const colWidth = (pageWidth - 2 * PAGE_MARGIN - gapCount * 8) / model.signatureLabels.length;
  model.signatureLabels.forEach((label, i) => {
    const x = PAGE_MARGIN + i * (colWidth + 8);
    doc.line(x, sigY, x + colWidth, sigY);
    doc.text(label, x, sigY + 4, { maxWidth: colWidth });
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
