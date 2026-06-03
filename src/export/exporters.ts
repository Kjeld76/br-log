import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { format } from "date-fns";
import { toCsv, type CsvColumn } from "./toCsv";
import {
  listEntries,
  getAllForBackup,
  parseBackup,
} from "../db/repository";
import {
  minutesToHhmm,
  minutesToDecimalHours,
} from "../lib/time";
import type { EntryListItem, BackupPayload, Objection } from "../types";

function fmtObjections(objs: Objection[]): string {
  return objs
    .filter((o) => o.reason.trim() || o.byWhom.trim())
    .map((o) => {
      const meta = [o.byWhom, o.date].filter(Boolean).join(", ");
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
      header: "Dauer (Dezimalstunden)",
      value: (e) => minutesToDecimalHours(e.durationMinutes),
    },
    { header: "Schlagwörter", value: (e) => e.tagLabels.join(", ") },
    { header: "Info für Geschäftsleitung", value: (e) => e.infoForManagement },
    {
      header: "Geplante Schicht",
      value: (e) => (e.hadPlannedShift ? "ja" : "nein"),
    },
    { header: "Schichtausgleich", value: (e) => e.shiftCompensationNote },
    { header: "Widersprüche GL", value: (e) => fmtObjections(e.objections) },
  ];
}

// Vollständige Spalten = öffentlich + vertrauliche Tätigkeit.
function fullColumns(): CsvColumn<EntryListItem>[] {
  return [
    ...publicColumns(),
    { header: "VERTRAULICH – Tätigkeit", value: (e) => e.secretDetails },
  ];
}

async function allEntriesSorted(): Promise<EntryListItem[]> {
  const items = await listEntries({});
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function saveText(
  defaultName: string,
  content: string,
  ext: string,
  filterName: string
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (!path) return null;
  await invoke("write_text_file", { path, contents: content });
  return path;
}

function stamp(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** GL-CSV: ausschließlich öffentliche Spalten. secret_details ist hier nicht verfügbar. */
export async function exportGlCsv(): Promise<string | null> {
  const rows = await allEntriesSorted();
  const csv = toCsv(rows, publicColumns());
  return saveText(`BR-Zeiten_GL_${stamp()}.csv`, csv, "csv", "CSV");
}

/** Voll-CSV: inkl. vertraulicher Tätigkeit (nur für die eigene Verwendung). */
export async function exportFullCsv(): Promise<string | null> {
  const rows = await allEntriesSorted();
  const csv = toCsv(rows, fullColumns());
  return saveText(`BR-Zeiten_VOLL_${stamp()}.csv`, csv, "csv", "CSV");
}

/** JSON-Backup: vollständige Datensicherung / Geräteübertragung. */
export async function exportJsonBackup(): Promise<string | null> {
  const payload = await getAllForBackup();
  const json = JSON.stringify(payload, null, 2);
  return saveText(`BR-Zeiten_Backup_${stamp()}.json`, json, "json", "JSON");
}

/**
 * Öffnet eine Backup-Datei und liefert den geparsten Inhalt zurück.
 * Die Konflikt-Zusammenfassung + Bestätigung passiert in der UI
 * (repository.analyzeImport / applyImport).
 */
export async function pickAndReadBackup(): Promise<BackupPayload | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path || typeof path !== "string") return null;
  const raw = await invoke<string>("read_text_file", { path });
  return parseBackup(raw);
}
