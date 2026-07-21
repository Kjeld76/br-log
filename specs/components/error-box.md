# Error-Box & Status-Banner

Anatomie: Eine zentrale Fehlerbox-Konstante (`errorBoxCls`, `src/lib/ui.ts`)
plus vier eigenständige, nicht konsolidierte Banner-/Badge-Familien, die
jeweils direkt als Tailwind-Klassenstring am Aufrufort stehen: Warn-Banner
(`warning-banner-*`), Info-Banner (`info-banner-*`), Erfolgs-Banner
(`success-banner-*`) sowie zwei kompakte Zähler-Badges (`error-badge`,
`warning-badge`). Alle sind reine `<p>`/`<div>`/`<span>`-Container, kein
gemeinsames Component.

## Error-Box (errorBoxCls, `src/lib/ui.ts:30-31`)

Tokens:
  Klasse: `rounded border border-error bg-error-surface px-3 py-2 text-sm
    text-error-ink`
  focus/height: nicht zutreffend — statischer Text-Container, kein
    interaktives Element, keine Touch-Zielgröße nötig

Zustände: nur sichtbar/unsichtbar (bedingtes Rendering `{error && <p
  className={errorBoxCls}>...}`) — kein Hover/Focus/Disabled/Loading, da
  keine Interaktion.

Verwendung: `src/lib/ui.ts:30-31`; `src/views/StatsView.tsx:116`,
`src/components/AppointmentAgenda.tsx:152`,
`src/components/AppointmentMonthGrid.tsx:164`,
`src/components/EntryList.tsx:159`, `src/components/AppointmentForm.tsx:646`.
Abweichende Inline-Variante (nicht über `errorBoxCls`, andere Utility-
Reihenfolge/-Werte, aber gleiche Token-Familie): `src/components/EntryForm.tsx:672`
(`rounded bg-error-surface px-3 py-2 text-sm text-error-ink` — ohne
`border-error`).

## Warn-Banner (warning-banner-*)

Tokens:
  Fläche/Text: `bg-warning-banner text-warning-banner-ink`, häufig mit
    `border border-warning-banner-line` (Trennlinie am Rand, z. B. unten)
  Hover (Ausblenden-Button innerhalb des Banners): `hover:bg-warning-banner-hover`
  Keine feste Klassen-Konstante — jede Fundstelle schreibt die Utilities
    lokal aus (kleine Layout-Unterschiede: `border-b` vs. vollflächig
    `rounded`, `items-start` vs. `items-center`)

Zustände: sichtbar/ausblendbar (eigener „Ausblenden"-Button pro Banner,
  keine automatische Zeitsteuerung wie beim Toast) · kein Fokus-/Disabled-
  Zustand am Banner-Container selbst (nur am „Ausblenden"-Button, globaler
  Fokusring).

Verwendung: `src/App.tsx:1071,1094` (verpasste Termin-Erinnerungen /
Erfassungs-Hinweis, beide mit „Ausblenden"-Button); `src/components/EntryForm.tsx:678`
(Überschneidungswarnung, hier ohne eigenen Ausblenden-Button, dafür mit
Warn-Aktion-Buttons darunter, s. button.md); `src/components/DbInfoPanel.tsx:180,224`;
`src/components/ExportPanel.tsx:299,364` (kombiniert mit
`border-warning-action-line` statt `-banner-line`); `src/components/RecoveryCodeReveal.tsx:84`;
`src/components/PrintReportPanel.tsx` (nicht-fataler Archivkopie-Fehler der
optionalen `reports/`-Kopie, Task 4/Issue #16 -- kein Ausblenden-Button, das
Banner verschwindet wie die anderen Status-Meldungen des Panels beim
nächsten Speichern-Versuch).

## Info-Banner (info-banner-*)

Tokens:
  Klasse (wiederkehrend identisch): `rounded-lg border border-info-banner-line
    bg-info-banner p-3 text-sm text-info-banner-ink` (teils zusätzlich
    `flex flex-wrap items-center gap-2`)

Zustände: nur sichtbar/unsichtbar (bedingtes Rendering je nach Formular-
  Zustand, z. B. `showLastDefaultsHint`) — kein Hover/Focus/Disabled am
  Banner selbst.

Verwendung: `src/components/AppointmentForm.tsx:218`,
`src/components/EntryForm.tsx:338` (mit zusätzlichem `bg-primary`-Button
„Übernehmen" darin, s. button.md).

## Erfolgs-Banner (success-banner-*)

Tokens:
  Klasse: `rounded border border-success-banner-line bg-success-banner p-3`
    — auffällig: **keine** `text-success-*`-Textfarbe gesetzt, der Text im
    Container erbt `text-primary-ink`/`text-secondary-ink` von den
    Kindelementen statt einer bannereigenen Textfarbe (anders als Warn-/
    Info-Banner, die konsequent eine `-ink`-Textfarbe mitführen)
  Fläche bereits im Light-Modus transluzent (rgba mit Alpha statt
    Volltonfarbe): `rgba(236, 253, 245, .4)` (`tokens.css:81`); Dark
    ebenfalls transluzent: `rgba(6, 78, 59, .1)` (`tokens.css:224`) —
    einzige der drei Banner-Familien, deren Light-Wert bereits rgba/Alpha
    ist (Warn-/Info-Banner sind im Light-Modus deckende Hex-Werte, z. B.
    `--color-warning-banner-surface: #fffbeb`, erst im Dark-Block rgba)

Zustände: nur sichtbar/unsichtbar, keine Interaktion am Container (enthält
  eine Checkbox mit eigenem nativem Fokus-/Hover-Verhalten).

Verwendung: `src/components/EntryForm.tsx:574-588` (Freizeitausgleich-Block,
einzige gefundene Fundstelle).

## Zähler-Badges (error-badge / warning-badge)

Tokens:
  Error-Badge: `rounded-full bg-error-badge px-1.5-2 py-0.5 text-xs
    text-error-badge-ink`, teils mit Icon (`alert-triangle`,
    `EntryList.tsx:293`)
  Warning-Badge: `rounded-full bg-warning-badge px-1.5-2 py-0.5 text-xs
    text-warning-badge-ink`, teils zusätzlich `font-medium` + Icon
    (`alert-triangle`, `AppointmentDetail.tsx:63`) -- seit #27 einheitlich
    `rounded-full` (vorher `rounded`, s. auch list-row.md); beide Fundstellen
    wurden im selben Redesign auf die Pillenform umgestellt
  Beide: kompakte Inline-Badges, kein eigener Rahmen (anders als die
    Banner-Familien, die durchgehend `border-*-line` tragen)

Zustände: nur sichtbar/unsichtbar (bedingtes Rendering je nach Datenlage,
  z. B. `objections.length > 0`) — keine Interaktion, kein
  Hover/Focus/Disabled.

Verwendung: Error-Badge in `src/components/EntryList.tsx:293`
(Widerspruch-Zähler), `src/components/EntryForm.tsx:672` (Widersprüche-Badge
im Akkordeon-Header); Warning-Badge in `src/components/EntryList.tsx:288`
(„keine geplante Schicht"), `src/components/AppointmentDetail.tsx:63`
(„Wichtig").

## Verifikation der Utilities (Grep-Gegenprobe)

`error`, `error-surface`, `error-ink`, `warning-banner`,
`warning-banner-hover`, `warning-banner-ink`, `warning-banner-line`,
`info-banner`, `info-banner-line`, `info-banner-ink`, `success-banner`,
`success-banner-line`, `error-badge`, `error-badge-ink`, `warning-badge`,
`warning-badge-ink` — alle in `tailwind.config.js` (`theme.extend.colors`)
definiert und auf `--color-*` in `src/tokens.css` gemappt (Root-Block +
`@media (prefers-color-scheme: dark)` + `[data-theme="dark"]`-Block).
