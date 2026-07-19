# BR-Log — Projektanweisungen

## Design-System-Direktive (UI-Arbeit in `src/`)

Baue und refaktoriere UI **ausschließlich** mit den semantischen Tokens aus
`src/tokens.css` (konsumiert über die Utilities in `tailwind.config.js`).
Keine hardcodierten Farben, `rgb()/rgba()`, Tailwind-Palettenfarben
(`slate-*`, `sky-*`, `red-*`, …, `white`/`black` als Farb-Utility) oder
arbiträren Farb-/Pixelwerte im Komponentencode. Unterstütze `light` und
`dark` über `[data-theme]` auf `<html>` mit `prefers-color-scheme`-Default
(Drei-Wege-Logik in `src/lib/theme.ts`). Halte WCAG 2.2 ein: Kontrast
≥ 4.5:1, sichtbarer `:focus-visible` (globale Regel in `styles.css`),
`prefers-reduced-motion` respektiert. Kein einfacher Spinner als einziger
Ladezustand. Kein `!important` zum Übersteuern von Tokens.

### Token-Quellen und Audit (harte Gates)

- **Token-Dateien** (einzige erlaubte Orte für Rohwerte): `src/tokens.css`
  (DOM) und `src/lib/tokens.ts` (PDF-Export, FOUC). Ausnahmen vom Audit:
  `src/assets/**` (Assets) und `src/lib/tokens.test.ts` (Hex dort sind
  Test-Fixtures der Token-Konsistenz).
- Nach **jeder** UI-Änderung ausführen — beide müssen **0 Treffer** liefern
  (Exit 0), inklusive der automatischen Theme-Sync-Prüfung (beide
  Dark-Blöcke in `tokens.css` müssen dieselben Tokens mit denselben Werten
  tragen):
  ```
  npm run audit:colors
  npm run audit:palette
  ```
- Neue Tokens IMMER in `:root` **und beiden** Dark-Blöcken pflegen
  (`@media (prefers-color-scheme: dark)` und `[data-theme="dark"]`), außer
  der Wert ist bewusst modusunabhängig (dann nur `:root`, mit Kommentar).

### Konsolidierungs-Regeln (Nutzer-Entscheide, bindend)

- **Grau:** nahe Slate-Schattierungen sind auf semantische Rollen
  zusammengeführt (`text-primary-ink`, `text-secondary-ink`,
  `hover:bg-surface-2`, Fokus-Farben) — ±1 Tailwind-Stufe in einem Kanal
  ist dort sanktionierte Vereinheitlichung.
- **Status:** `green` → `emerald`-Erfolgs-Tokens; ±1-Stufen innerhalb einer
  Statusfamilie → die Token-Rolle; Dark-Alpha-Feinabweichungen → die
  nächstliegende Token-Fläche derselben Familie (Zuordnung nach
  semantischer Rolle: Badge/Banner/Callout/Code).
- Alle **anderen** Farben (Marke, Sonderrollen) bleiben exakt: passendes
  Token verwenden oder ein neues, sprechend benanntes Token mit den exakten
  Bestandswerten anlegen — nie still driften.

### Layout, Plattformen, Typografie

- Desktop **und** Android gleichwertig (Tauri 2). Tailwinds `sm:`/`md:`
  sind viewport-basiert und erlaubt; gerätespezifische Breakpoints sind es
  nicht. Container Queries für neue platzabhängige Komponenten.
- Touch-Ziele: `min-h-touch` (48px) für primäre Aktionen, `min-h-touch-pointer`
  (44px) als Untergrenze; Hover-Effekte greifen nur bei `hover: hover`
  (Tailwind `future.hoverOnlyWhenSupported`).
- **Safe-Areas: bewusst KEIN `viewport-fit=cover` und keine
  `env(safe-area-inset-*)`-Utilities** — die native Android-Seite
  (MainActivity, Insets-Listener) paddet den WebView; `env()` liefert dort
  konstant 0px. Der Kommentar in `index.html` dokumentiert das.
- Typografie läuft über die Tailwind-Standard-Skala (gilt als tokenisiert);
  Spacing/Radius ebenso — nur arbiträre Werte (`p-[13px]`) sind verboten.
  Die App-UI hat keine Display-/Headline-Stufen; `clamp()`-Typo-Tokens
  werden eingeführt, sobald eine entsteht.
- Z-Ebenen nur über die Token-Utilities (`z-dropdown` … `z-tooltip`) —
  nie numerische `z-*`-Werte für Overlays/Dialoge/Toasts.

### Komponenten-Specs

Pro Komponente liegt eine Spec unter `specs/components/*.md`
(Anatomie, konsumierte Tokens, Zustände, Fundstellen). Beim Ändern einer
Komponente die Spec mitziehen; neue Komponenten bekommen eine neue Spec.

### Verifikation bei UI-Änderungen

Beide Farbmodi real prüfen (Theme-Umschalter in den Einstellungen),
Tastatur-Fokus sichtbar, `npx vitest run`, `npx tsc --noEmit`,
`npx eslint src` und die beiden Audit-Scripts grün.
