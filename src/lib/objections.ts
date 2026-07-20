// Formatierung der Widerspruchs-Metadaten (Wer/Wann). EINZIGE Implementierung
// dieser Formatierung -- EntryDetail (Anzeige, Separator " · ") und der
// CSV-Export (exporters.ts, Separator ", ") bauten das bisher getrennt und
// hätten bei einer künftigen Änderung auseinanderlaufen können (Finding 50).

import type { Objection } from "../types";

// Nur byWhom/date werden gebraucht -- als Pick statt volles Objection, damit
// auch die GL-Projektion (glProjection.ts GlEntryView.objections, ohne `id`)
// hier ohne Anpassung durchgereicht werden kann.
type ObjectionMeta = Pick<Objection, "byWhom" | "date">;

/** [byWhom, date] gefiltert und mit dem übergebenen Separator gejoint. */
export function formatObjectionMeta(o: ObjectionMeta, separator: string): string {
  return [o.byWhom, o.date].filter(Boolean).join(separator);
}
