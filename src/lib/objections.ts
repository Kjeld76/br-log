// Formatierung der Widerspruchs-Metadaten (Wer/Wann). EINZIGE Implementierung
// dieser Formatierung -- EntryDetail (Anzeige, Separator " · ") und der
// CSV-Export (exporters.ts, Separator ", ") bauten das bisher getrennt und
// hätten bei einer künftigen Änderung auseinanderlaufen können (Finding 50).

import type { Objection } from "../types";

/** [byWhom, date] gefiltert und mit dem übergebenen Separator gejoint. */
export function formatObjectionMeta(o: Objection, separator: string): string {
  return [o.byWhom, o.date].filter(Boolean).join(separator);
}
