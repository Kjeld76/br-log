import type { Objection } from "../types";

/**
 * Baut den öffentlichen Suchtext (NICHT vertraulich): GL-Info + Schlagwort-Labels
 * + Widerspruchs-Begründungen/Namen.
 */
export function buildPublicContent(args: {
  infoForManagement: string;
  tagLabels: string[];
  objections: Pick<Objection, "reason" | "byWhom">[];
}): string {
  return [
    args.infoForManagement,
    args.tagLabels.join(" "),
    args.objections.map((o) => `${o.reason} ${o.byWhom}`).join(" "),
  ]
    .filter((s) => s && s.trim().length > 0)
    .join(" \n ");
}

/** Baut den vertraulichen Suchtext (NUR secret_details) – getrennte FTS-Spalte. */
export function buildSecretContent(secretDetails: string): string {
  return secretDetails || "";
}

/**
 * Baut einen spaltengebundenen FTS5-MATCH-Ausdruck (Prefix-Suche, AND-verknüpft).
 * Beispiel: {secret_content} : ("foo"* "bar"*)
 */
export function buildFtsMatch(
  column: "public_content" | "secret_content",
  term: string
): string | null {
  const tokens = term
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["()*:]/g, "")) // FTS5-Sonderzeichen entfernen
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`); // jedes Token als Prefix
  if (tokens.length === 0) return null;
  return `{${column}} : (${tokens.join(" ")})`;
}
