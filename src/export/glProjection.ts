// DIE eine GL-Projektion (Issue #16, harte Vertraulichkeitsgarantie). Vorher
// pflegten GL-CSV (exporters.ts publicColumns) und PDF-Report (reportPdf.ts
// buildReportModel) je einen eigenen Feld-Filter parallel -- ein künftig auf
// EntryListItem ergänztes Feld hätte in den zweiten Filter durchrutschen
// können, ohne dass ein Test das bemerkt. Ab jetzt gibt es nur noch DIESE
// eine Stelle, die festlegt, was die Geschäftsleitung zu sehen bekommt.

import type { EntryListItem } from "../types";

/**
 * DIE eine GL-Projektion: einzige Stelle, die festlegt, welche Felder eines
 * Zeiteintrags die App gegenüber der Geschäftsleitung offenlegt. GL-CSV und
 * PDF-Report konsumieren AUSSCHLIESSLICH diese Sicht -- ein zweiter, parallel
 * gepflegter Feld-Filter ist verboten (Issue #16, harte Garantie).
 */
export interface GlEntryView {
  date: string; // YYYY-MM-DD
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  pauseMinutes: number;
  infoForManagement: string;
  tagLabels: string[];
  hadPlannedShift: boolean;
  shiftCompensationNote: string;
  isCompensation: boolean;
  objections: { reason: string; byWhom: string; date: string | null }[];
}

/**
 * Baut die GL-Sicht aus einem geladenen Listen-Item.
 *
 * EXPLIZITE Feldkopie -- KEIN `{ ...e }`-Spread: ein Spread würde jedes
 * künftig auf EntryListItem/TimeEntryBase ergänzte Feld automatisch mit
 * übernehmen, insbesondere ein versehentlich durchgereichtes
 * `secretDetails`. Die explizite Liste unten ist die einzige Stelle, die ein
 * neues Feld bewusst freischalten muss -- ein Canary-Test
 * (glProjection.test.ts) prüft genau das ab.
 */
export function glEntryView(e: EntryListItem): GlEntryView {
  return {
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    durationMinutes: e.durationMinutes,
    pauseMinutes: e.pauseMinutes,
    infoForManagement: e.infoForManagement,
    tagLabels: e.tagLabels,
    hadPlannedShift: e.hadPlannedShift,
    shiftCompensationNote: e.shiftCompensationNote,
    isCompensation: e.isCompensation ?? false,
    objections: e.objections.map((o) => ({
      reason: o.reason,
      byWhom: o.byWhom,
      date: o.date,
    })),
  };
}
