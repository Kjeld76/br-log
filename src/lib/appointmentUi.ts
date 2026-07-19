// Geteilte UI-Konstanten des Terminkalenders: Farbpalette (Schlüssel ->
// Tailwind-Klassen für Chip/Punkt, hell + dunkel) und Erinnerungs-Vorlagen.
// Zentral hier, weil MonthGrid, Agenda, Formular und Detailansicht dieselben
// Zuordnungen brauchen (Muster von lib/ui.ts: EINE Quelle statt Drift).

import type { AppointmentColor } from "../types";

export interface ColorOption {
  value: AppointmentColor;
  label: string;
  /** Chip-Hintergrund/-Text (Monatsgrid, Agenda). */
  chipCls: string;
  /** Kräftiger Farbpunkt (Farbauswahl im Formular, Legende). */
  dotCls: string;
}

// "Standard" (color = null) nutzt bewusst denselben Sky-Ton wie die übrige
// App-Akzentfarbe -- die Palette ergänzt nur Unterscheidungsfarben.
// Klassen referenzieren --color-appt-*-Tokens (tokens.css); Definition in
// styles.css (.appt-chip-*/.appt-dot-*) -- semantisch statt Palette-Utilities,
// kein dark:-Zweig mehr nötig (Light/Dark steckt im Token).
export const DEFAULT_CHIP_CLS = "appt-chip-sky";
export const DEFAULT_DOT_CLS = "appt-dot-sky";

export const COLOR_OPTIONS: ColorOption[] = [
  {
    value: "sky",
    label: "Blau",
    chipCls: DEFAULT_CHIP_CLS,
    dotCls: DEFAULT_DOT_CLS,
  },
  {
    value: "amber",
    label: "Gelb",
    chipCls: "appt-chip-amber",
    dotCls: "appt-dot-amber",
  },
  {
    value: "emerald",
    label: "Grün",
    chipCls: "appt-chip-emerald",
    dotCls: "appt-dot-emerald",
  },
  {
    value: "violet",
    label: "Lila",
    chipCls: "appt-chip-violet",
    dotCls: "appt-dot-violet",
  },
  {
    value: "rose",
    label: "Rot",
    chipCls: "appt-chip-rose",
    dotCls: "appt-dot-rose",
  },
];

export function chipClsFor(color: AppointmentColor | null): string {
  return COLOR_OPTIONS.find((c) => c.value === color)?.chipCls ?? DEFAULT_CHIP_CLS;
}

export function dotClsFor(color: AppointmentColor | null): string {
  return COLOR_OPTIONS.find((c) => c.value === color)?.dotCls ?? DEFAULT_DOT_CLS;
}

/** Erinnerungs-Vorlagen (Vorlauf in Minuten) mit deutschen Labels. */
export const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Zum Termin" },
  { minutes: 5, label: "5 Min. vorher" },
  { minutes: 15, label: "15 Min. vorher" },
  { minutes: 30, label: "30 Min. vorher" },
  { minutes: 60, label: "1 Std. vorher" },
  { minutes: 24 * 60, label: "1 Tag vorher" },
  { minutes: 7 * 24 * 60, label: "1 Woche vorher" },
];

export function reminderLabel(minutesBefore: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutesBefore);
  if (preset) return preset.label;
  if (minutesBefore % (24 * 60) === 0) {
    const days = minutesBefore / (24 * 60);
    return `${days} Tage vorher`;
  }
  if (minutesBefore % 60 === 0) {
    return `${minutesBefore / 60} Std. vorher`;
  }
  return `${minutesBefore} Min. vorher`;
}
