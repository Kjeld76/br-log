import { invoke } from "@tauri-apps/api/core";
import { toCsv, type CsvColumn } from "./toCsv";
import {
  listEntries,
  listEntriesFull,
  getAllForBackup,
  parseBackup,
  type PeriodFilter,
} from "../db/repository";
import { minutesToHhmm, formatDecimalHoursDe } from "../lib/time";
import { formatObjectionMeta } from "../lib/objections";
import { todayIso } from "../lib/calendar";
import type {
  EntryListItem,
  EntryFullItem,
  BackupPayload,
  Objection,
} from "../types";

function fmtObjections(objs: Objection[]): string {
  return objs
    .filter((o) => o.reason.trim() || o.byWhom.trim())
    .map((o) => {
      const meta = formatObjectionMeta(o, ", ");
      return meta ? `${o.reason} (${meta})` : o.reason;
    })
    .join(" | ");
}

// Öffentliche Spalten (GL-tauglich – OHNE secret_details).
function publicColumns(): CsvColumn<EntryListItem>[] {
  return [
    { header: "Datum", value: (e) => e.date },
    { header: "Von", value: (e) => e.startTime ?? "" },
    { header: "Bis", value: (e) => e.endTime ?? "" },
    { header: "Dauer (Std:Min)", value: (e) => minutesToHhmm(e.durationMinutes) },
    {
      // Finding 11: Komma statt Punkt -- deutsches Excel (Zielformat laut
      // toCsv.ts: Semikolon-Trenner + BOM) interpretiert einen Punkt-String
      // sonst als Text oder sogar als Datum statt als aufsummierbare Zahl.
      header: "Dauer (Dezimalstunden)",
      value: (e) => formatDecimalHoursDe(e.durationMinutes),
    },
    { header: "Schlagwörter", value: (e) => e.tagLabels.join(", ") },
    { header: "Info für Geschäftsleitung", value: (e) => e.infoForManagement },
    {
      header: "Geplante Schicht",
      value: (e) => (e.hadPlannedShift ? "ja" : "nein"),
    },
    { header: "Schichtausgleich", value: (e) => e.shiftCompensationNote },
    {
      // Finding 14: Freizeitausgleich-Kennzeichnung auch im Export sichtbar.
      header: "Freizeitausgleich",
      value: (e) => (e.isCompensation ? "ja" : "nein"),
    },
    { header: "Widersprüche GL", value: (e) => fmtObjections(e.objections) },
  ];
}

// Vollständige Spalten = öffentlich + vertrauliche Tätigkeit. Braucht das volle
// Item (EntryFullItem) mit secretDetails; publicColumns (auf EntryListItem) sind
// kontravariant kompatibel und werden übernommen.
function fullColumns(): CsvColumn<EntryFullItem>[] {
  return [
    ...publicColumns(),
    { header: "VERTRAULICH – Tätigkeit", value: (e) => e.secretDetails },
  ];
}

// GL-/schlanker Export: Listen-Items OHNE secretDetails. `period` (Finding 8)
// reicht die bereits im Repository vorhandene EntryFilter.from/to durch --
// ohne Auswahl (undefined) bleibt es wie bisher der Gesamtbestand.
async function allEntriesSorted(period?: PeriodFilter): Promise<EntryListItem[]> {
  const items = await listEntries({ from: period?.from, to: period?.to });
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Vertraulicher Voll-Export: expliziter Voll-Lade-Pfad INKL. secretDetails.
async function allEntriesSortedFull(
  period?: PeriodFilter
): Promise<EntryFullItem[]> {
  const items = await listEntriesFull({ from: period?.from, to: period?.to });
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function saveText(
  defaultName: string,
  content: string,
  ext: string,
  filterName: string
): Promise<string | null> {
  return invoke<string | null>("export_text_file", {
    defaultName,
    filterName,
    extension: ext,
    contents: content,
  });
}

/** Dateiname inkl. Zeitraum, falls eine Von-/Bis-Auswahl (Finding 8) getroffen wurde. */
function csvFileName(prefix: string, period?: PeriodFilter): string {
  if (period?.from || period?.to) {
    return `BR-Log_${prefix}_${period.from ?? "Anfang"}_bis_${
      period.to ?? "Ende"
    }.csv`;
  }
  return `BR-Log_${prefix}_${todayIso()}.csv`;
}

/**
 * GL-CSV: ausschließlich öffentliche Spalten. secret_details ist hier nicht
 * verfügbar. `period` (Finding 8) grenzt auf einen Zeitraum ein -- ohne
 * Angabe wie bisher der Gesamtbestand (Rückwärtskompatibilität).
 */
export async function exportGlCsv(period?: PeriodFilter): Promise<string | null> {
  const rows = await allEntriesSorted(period);
  const csv = toCsv(rows, publicColumns());
  return saveText(csvFileName("GL", period), csv, "csv", "CSV");
}

/** Voll-CSV: inkl. vertraulicher Tätigkeit (nur für die eigene Verwendung). */
export async function exportFullCsv(
  period?: PeriodFilter
): Promise<string | null> {
  const rows = await allEntriesSortedFull(period);
  const csv = toCsv(rows, fullColumns());
  return saveText(csvFileName("VOLL", period), csv, "csv", "CSV");
}

/** JSON-Backup: vollständige Datensicherung / Geräteübertragung. */
export async function exportJsonBackup(): Promise<string | null> {
  const payload = await getAllForBackup();
  const json = JSON.stringify(payload, null, 2);
  return saveText(`BR-Log_Backup_${todayIso()}.json`, json, "json", "JSON");
}

/**
 * Öffnet eine Backup-Datei und liefert den geparsten Inhalt zurück.
 * Die Konflikt-Zusammenfassung + Bestätigung passiert in der UI
 * (repository.analyzeImport / applyImport).
 */
export async function pickAndReadBackup(): Promise<BackupPayload | null> {
  const picked = await invoke<{ name: string; contents: string } | null>(
    "import_text_file",
    { filterName: "JSON", extension: "json" }
  );
  if (!picked) return null;
  return parseBackup(picked.contents);
}
