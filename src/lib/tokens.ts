// Token-Datei: einzige erlaubte Rohwerte außerhalb tokens.css (siehe dortiger
// Kopfkommentar). Nicht-DOM-Kontexte -- PDF-Export (jsPDF/jspdf-autotable,
// kein DOM zur Renderzeit) und das FOUC-Inline-Script/applyTheme (läuft vor
// dem ersten Style-Sheet-Zugriff, also bevor CSS-Custom-Properties aus
// tokens.css existieren) -- können keine CSS-Variablen konsumieren. Deshalb
// hier dieselben Werte als benannte TS-Konstanten, synchron zu tokens.css zu
// halten.

/**
 * Deckt sich mit --color-background (Light/Dark) aus tokens.css. Nur für
 * theme.ts (applyTheme): setzt die Hintergrundfarbe synchron mit dem
 * Theme-Wechsel, noch bevor die eigentliche CSS-Klasse/Variable greift --
 * verhindert den Hell/Dunkel-Blitz (FOUC) beim Start bzw. Theme-Wechsel.
 */
export const FOUC_BG = { light: "#f8fafc", dark: "#0f172a" } as const;

/**
 * Farben für den PDF-Export (export/reportPdf.ts) und dessen HTML-Vorschau
 * (components/PrintReportPanel.tsx). Ein PDF druckt immer auf "Papier" --
 * anders als FOUC_BG deshalb flache Werte statt Light/Dark.
 *
 * jsPDF/jspdf-autotable akzeptieren Hex-Strings direkt (siehe deren
 * encodeColorString/unifyColor) -- die Werte hier ersetzen die vormals
 * inline verstreuten RGB-Arrays/Hex-Literale 1:1 (bytegleiche PDF-Ausgabe).
 */
export const PRINT = {
  /** Fließtext & Unterschriftslinie (PDF + Vorschau) -- durchgängig Schwarz. */
  ink: "#000000",
  /** PDF-/Druckseite ist immer "Papier", unabhängig vom App-Theme. */
  paper: "#ffffff",
  /** Zellrahmen der Vorschau-Tabelle (PrintReportPanel.tsx), vormals "#999". */
  tableBorder: "#999999",
  /**
   * Tabellenkopf-Hintergrund im PDF (autotable headStyles.fillColor),
   * vormals inline [71, 85, 105] (slate-600).
   */
  headerBg: "#475569",
  /** Seitenfuß-Text "Seite X von Y" im PDF, vormals doc.setTextColor(100). */
  footerMuted: "#646464",
} as const;
