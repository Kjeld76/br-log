// Kleine, generische Array-Helfer ohne fachlichen Bezug.

/**
 * Toggelt einen Wert in einer ID-Liste (enthalten -> entfernen, sonst
 * anhängen). Konsolidiert die zuvor wortgleich doppelte Toggle-Logik aus
 * EntryForm.tsx (Schlagwort-Auswahl im Formular) und EntryList.tsx
 * (Schlagwort-Filter der Historie) (Finding 47).
 */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
