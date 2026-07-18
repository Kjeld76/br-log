#!/usr/bin/env node
// Dependency-freier Ersatz für die rg-basierten Audit-Scripts (rg ist auf
// diesem Host nicht im PATH). Durchsucht rekursiv src/ nach Alt-Farbwerten
// bzw. Tailwind-Palette-Klassen, die noch nicht über tokens.css laufen.
// Prüft zusätzlich in BEIDEN Modi ein Theme-Sync-Gate: die zwei Dark-Blöcke
// in tokens.css (@media (prefers-color-scheme: dark) vs. manueller
// [data-theme="dark"]-Toggle) müssen dieselben Custom-Property-Namen und
// -Werte definieren (verhindert vergessene Dark-Nachträge wie in Task 8).
//
// Nutzung: node scripts/audit-tokens.mjs <colors|palette>

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const MODE = process.argv[2];

const PATTERNS = {
  colors: [/#[0-9a-fA-F]{3,8}\b/g, /\brgba?\(/g],
  palette: [
    /\b(bg|text|border|ring|outline|divide|placeholder|from|to|via)-(slate|sky|red|emerald|green|amber|rose|white|black)(-|\b)/g,
  ],
};

if (!MODE || !PATTERNS[MODE]) {
  console.error(`Unbekannter Modus: "${MODE ?? ""}". Erwartet: colors | palette`);
  process.exit(2);
}

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const TOKENS_CSS = join(SRC_DIR, "tokens.css");

const SKIP_FILES = new Set([
  TOKENS_CSS,
  join(SRC_DIR, "lib", "tokens.ts"),
  // Testet die Token-Werte gegen fixe erwartete Hex-Strings (TDD-Vorgabe) --
  // das sind Prüf-Fixtures gegen die Quelle, keine unmigrierten Rohwerte.
  join(SRC_DIR, "lib", "tokens.test.ts"),
]);
const SKIP_DIRS = new Set([join(SRC_DIR, "assets")]);

const ALLOWED_EXT = new Set([".ts", ".tsx", ".css", ".html"]);

function isUnderSkippedDir(path) {
  for (const dir of SKIP_DIRS) {
    if (path === dir || path.startsWith(dir + sep)) return true;
  }
  return false;
}

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isUnderSkippedDir(full)) continue;
      collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

let files = [];
try {
  files = collectFiles(SRC_DIR, []);
} catch (err) {
  console.error(`Konnte ${SRC_DIR} nicht lesen: ${err.message}`);
  process.exit(2);
}

const patterns = PATTERNS[MODE];
let total = 0;

for (const file of files) {
  if (SKIP_FILES.has(file)) continue;
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot);
  if (!ALLOWED_EXT.has(ext)) continue;
  if (!statSync(file).isFile()) continue;

  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const relPath = relative(ROOT, file).split(sep).join("/");

  lines.forEach((line, idx) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        console.log(`${relPath}:${idx + 1}: ${match[0]}`);
        total++;
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  });
}

console.log(`${total} Treffer`);

// --- Theme-Sync-Gate -----------------------------------------------------
// Die zwei Dark-Blöcke in tokens.css (System-Dark via @media und der
// manuelle [data-theme="dark"]-Toggle) müssen exakt dieselben Custom-
// Property-Namen und -Werte definieren. Läuft unabhängig vom MODE mit,
// damit ein vergessener Nachtrag (wie in Task 8) in jedem Audit-Lauf auffällt.

/** Extrahiert den Inhalt des ersten { ... }-Blocks ab startIndex (Klammern zählen, keine Dependency). */
function extractBraceBlock(css, startIndex) {
  const open = css.indexOf("{", startIndex);
  if (open === -1) return null;
  let depth = 1;
  let i = open + 1;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  if (depth !== 0) return null;
  return { content: css.slice(open + 1, i - 1), end: i };
}

/** Liest Custom-Property-Deklarationen (Name -> whitespace-normalisierter Wert) aus einem Block-Inhalt. */
function parseDeclarations(blockContent) {
  const decls = new Map();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(blockContent)) !== null) {
    decls.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return decls;
}

function loadThemeBlocks(css) {
  const mediaIdx = css.indexOf('@media (prefers-color-scheme: dark)');
  if (mediaIdx === -1) {
    throw new Error('@media (prefers-color-scheme: dark)-Block nicht gefunden');
  }
  const mediaOuter = extractBraceBlock(css, mediaIdx);
  if (!mediaOuter) throw new Error('@media (prefers-color-scheme: dark)-Block ist nicht geschlossen');

  const rootSelectorIdx = mediaOuter.content.indexOf(':root:not([data-theme="light"])');
  if (rootSelectorIdx === -1) {
    throw new Error(':root:not([data-theme="light"])-Block im @media-Block nicht gefunden');
  }
  const mediaInner = extractBraceBlock(mediaOuter.content, rootSelectorIdx);
  if (!mediaInner) throw new Error(':root:not([data-theme="light"])-Block ist nicht geschlossen');

  // [data-theme="dark"] außerhalb des @media-Blocks suchen (Suche erst ab dessen Ende).
  const darkSelectorIdx = css.indexOf('[data-theme="dark"]', mediaOuter.end);
  if (darkSelectorIdx === -1) {
    throw new Error('[data-theme="dark"]-Block nicht gefunden');
  }
  const darkBlock = extractBraceBlock(css, darkSelectorIdx);
  if (!darkBlock) throw new Error('[data-theme="dark"]-Block ist nicht geschlossen');

  return {
    media: parseDeclarations(mediaInner.content),
    darkToggle: parseDeclarations(darkBlock.content),
  };
}

let themeSyncDiffs = 0;
const relTokens = relative(ROOT, TOKENS_CSS).split(sep).join("/");
try {
  const tokensCss = readFileSync(TOKENS_CSS, "utf8");
  const { media, darkToggle } = loadThemeBlocks(tokensCss);

  const names = new Set([...media.keys(), ...darkToggle.keys()]);
  for (const name of names) {
    const inMedia = media.has(name);
    const inDarkToggle = darkToggle.has(name);
    if (inMedia && !inDarkToggle) {
      console.log(`${relTokens}: Theme-Sync: ${name} fehlt in [data-theme="dark"] (nur im @media-Block vorhanden)`);
      themeSyncDiffs++;
    } else if (!inMedia && inDarkToggle) {
      console.log(`${relTokens}: Theme-Sync: ${name} fehlt im @media (prefers-color-scheme: dark)-Block (nur in [data-theme="dark"] vorhanden)`);
      themeSyncDiffs++;
    } else if (media.get(name) !== darkToggle.get(name)) {
      console.log(`${relTokens}: Theme-Sync: ${name} hat abweichende Werte (@media: "${media.get(name)}" vs. [data-theme="dark"]: "${darkToggle.get(name)}")`);
      themeSyncDiffs++;
    }
  }
} catch (err) {
  console.log(`${relTokens}: Theme-Sync: Prüfung fehlgeschlagen: ${err.message}`);
  themeSyncDiffs++;
}

console.log(`Theme-Sync: ${themeSyncDiffs} Abweichungen`);

process.exit(total > 0 || themeSyncDiffs > 0 ? 1 : 0);
