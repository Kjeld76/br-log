#!/usr/bin/env node
// Dependency-freier Ersatz für die rg-basierten Audit-Scripts (rg ist auf
// diesem Host nicht im PATH). Durchsucht rekursiv src/ nach Alt-Farbwerten
// bzw. Tailwind-Palette-Klassen, die noch nicht über tokens.css laufen.
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

const SKIP_FILES = new Set([
  join(SRC_DIR, "tokens.css"),
  join(SRC_DIR, "lib", "tokens.ts"),
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
process.exit(total > 0 ? 1 : 0);
