// Pure Vorschau-Builder für die Import-Bestätigungsflüsse (JSON-Backup und
// ICS) -- UI-frei und testbar. Liefert nur Anzeigedaten; das ExportPanel
// rendert daraus EIN generisches Vorschau-Panel (Finding: zwei fast
// identische Panels wurden dadurch auf eine Stelle konsolidiert, siehe #7).
import type { ImportSummary } from "../types";

export interface ImportPreview {
  title: string;
  bullets: string[];
  detail?: { heading: string; lines: { strong?: string; text: string }[] };
}

export function jsonImportPreview(summary: ImportSummary): ImportPreview {
  const bullets = [
    `${summary.newEntries} neue Einträge`,
    `${summary.conflicts} Konflikte (neuere Version gewinnt)`,
    `${summary.unchanged} unverändert`,
    `${summary.newTags} neue Schlagwörter`,
  ];

  const appointmentTotal =
    (summary.newAppointments ?? 0) +
    (summary.appointmentConflicts ?? 0) +
    (summary.appointmentUnchanged ?? 0);
  if (appointmentTotal > 0) {
    bullets.push(
      `Termine: ${summary.newAppointments ?? 0} neu, ${
        summary.appointmentConflicts ?? 0
      } aktualisiert, ${summary.appointmentUnchanged ?? 0} unverändert`
    );
  }

  const preview: ImportPreview = { title: "Import-Vorschau", bullets };
  if (summary.conflictItems.length > 0) {
    preview.detail = {
      heading: `Diese ${summary.conflictItems.length} lokalen Einträge würden überschrieben:`,
      lines: summary.conflictItems.map((c) => ({
        strong: c.date,
        text: " — " + c.label,
      })),
    };
  }
  return preview;
}

export function icsImportPreview(plan: {
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  warnings: string[];
}): ImportPreview {
  const preview: ImportPreview = {
    title: "ICS-Import-Vorschau",
    bullets: [
      `${plan.newCount} neue Termine`,
      `${plan.updatedCount} aktualisiert (bestehende Serie/Termin wird ersetzt)`,
      `${plan.unchangedCount} unverändert`,
    ],
  };

  if (plan.warnings.length > 0) {
    preview.detail = {
      heading: "Hinweise:",
      lines: plan.warnings.map((w) => ({ text: w })),
    };
  }
  return preview;
}
