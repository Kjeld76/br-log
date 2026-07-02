// Generischer CSV-Formatter mit konfigurierbaren Spalten.
// Erweiterbar: weitere Formatter (PDF/Excel) können dieselben Spaltendefinitionen nutzen.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export interface CsvOptions {
  delimiter?: string; // Standard ";" (Excel DE)
  bom?: boolean; // Standard true (UTF-8 mit BOM, Umlaute in Excel)
}

export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: CsvOptions = {}
): string {
  const delimiter = opts.delimiter ?? ";";
  const bom = opts.bom ?? true;

  const esc = (v: unknown): string => {
    let s = v === null || v === undefined ? "" : String(v);
    // Finding 61: Formel-Injection-Schutz für Excel. Zellen, die mit =, +, -
    // oder @ beginnen, wertet Excel als Formel aus (bei '=' potenziell mit
    // DDE/Kommando-Ausführung nach Sicherheitsabfrage). Ein Präfix-Apostroph
    // erzwingt Text-Interpretation -- reines Quoting reicht NICHT, Excel wertet
    // ="…" trotzdem als Formel aus. Nebeneffekt: behebt auch den Lesbarkeits-
    // Bug, dass z. B. "- Gespräch mit ..." als #NAME?-Fehler statt Text erscheint.
    if (/^[=+\-@]/.test(s)) {
      s = "'" + s;
    }
    if (
      s.includes('"') ||
      s.includes(delimiter) ||
      s.includes("\n") ||
      s.includes("\r")
    ) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines: string[] = [];
  lines.push(columns.map((c) => esc(c.header)).join(delimiter));
  for (const row of rows) {
    lines.push(columns.map((c) => esc(c.value(row))).join(delimiter));
  }
  const BOM = String.fromCharCode(0xfeff);
  return (bom ? BOM : "") + lines.join("\r\n");
}
