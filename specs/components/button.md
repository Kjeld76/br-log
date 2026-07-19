# Button

Anatomie: Natives `<button type="button">`; kein gemeinsames `<Button>`-Component.
Zwei Varianten sind als Konstanten in `src/lib/ui.ts` zentralisiert (Sekundär
groß/kompakt), die übrigen bleiben als lokal ausgeschriebene Tailwind-Klassen-
strings direkt am Aufrufort (`src/lib/ui.ts:9-15` dokumentiert das bewusst:
der Primär-Button trägt fünf kontextabhängige Größen, eine Vereinheitlichung
würde reale Unterschiede einebnen). Fünf Farbfamilien: Primär, Sekundär,
Danger, Warn-Aktion (solid + Ghost), Outline-Primär.

## Primär (bg-primary)

Tokens:
  Fläche/Text: `bg-primary text-on-primary`, `hover:bg-primary-hover`
  Form: `rounded` (einmal `rounded-full` als Pill, s. u.); Schriftgewicht
    meist `font-medium`, einmal `font-semibold` (EntryForm.tsx:717)
  Größe: keine einheitliche Größe — `px-3 py-1`/`text-xs` (Pill,
    EntryForm.tsx:342) über `px-3 py-2` (EntryList.tsx:95) und `px-4 py-2`
    (Standard: App.tsx:1026, LockScreen.tsx:185, TagManager.tsx:90,
    RecoveryCodeReveal.tsx:102, SecurityPanel.tsx:164,
    PrintReportPanel.tsx:155) bis `px-6 py-2` (EntryForm.tsx:717,
    AppointmentForm.tsx:659)
  disabled: `disabled:opacity-50` an fast allen Stellen; AppointmentForm.tsx:659
    weicht mit `disabled:opacity-60` ab (reale Drift, nicht vereinheitlicht)
  height/touch: nur an zwei Stellen `min-h-touch` gesetzt (EntryForm.tsx:717:
    `min-h-touch flex-1 … sm:min-h-0 sm:flex-none`; LockScreen.tsx:360 beim
    Outline-Pendant), alle übrigen Primär-Buttons ohne Touch-Mindesthöhe
  focus: kein lokales `focus-visible:`-Styling — es gilt ausschließlich der
    globale `:focus-visible { outline: var(--focus-width) solid
    var(--color-focus-ring) }` aus `src/styles.css:22-25`

Zustände: default · hover (`hover:bg-primary-hover`) · focus-visible (global)
  · disabled (`opacity-50`/vereinzelt `opacity-60`, s. o.) · loading — EntryForm.tsx:721
  tauscht bei `saving` nur den Label-Text ("Speichern…"), kein Spinner, kein
  `aria-busy`. active/pressed — nicht vorhanden (kein `:active`/`active:`-Utility
  im gesamten `src/`, geprüft per Grep).

Verwendung: `src/App.tsx:1026` (Fehler-Retry), `src/App.tsx` „Erneut
versuchen"; `src/components/EntryForm.tsx:342,717`; `src/components/EntryList.tsx:95`
(„+ Neuer Eintrag"); `src/components/AppointmentForm.tsx:659`;
`src/views/LockScreen.tsx:185`; `src/components/TagManager.tsx:90`;
`src/components/RecoveryCodeReveal.tsx:102`; `src/components/SecurityPanel.tsx:164`;
`src/components/PrintReportPanel.tsx:155`.
Verwandtes Muster (kein Button): `bg-primary`/`text-on-primary` markiert auch
den aktiven Zustand von Segmented-Control-Toggles, z. B.
`src/components/EntryForm.tsx:362` (Von/Bis-Umschalter).

## Sekundär (secondaryBtnCls / secondaryBtnSmCls, `src/lib/ui.ts:22-27`)

Tokens:
  Groß (`secondaryBtnCls`): `rounded border border-border-strong px-4 py-2
    text-sm text-primary-ink hover:bg-surface-2`
  Kompakt (`secondaryBtnSmCls`): `rounded border border-border-strong px-3
    py-1.5 text-sm text-primary-ink hover:bg-surface-2`
  Fläche: transparent (kein `bg-*`), nur Rahmen + Hover-Fläche `surface-2`
  height/touch: nicht Teil der Konstante; einzelne Aufrufer ergänzen es lokal
    (`EntryForm.tsx:708`: `+ " min-h-touch flex-1 sm:min-h-0 sm:flex-none"`;
    `AppointmentMonthGrid.tsx:138`: `+ " min-h-touch-pointer sm:min-h-0"`)
  focus: kein lokales `focus-visible:` — globaler Ring aus `styles.css:22-25`

Zustände: default · hover (`hover:bg-surface-2`) · focus-visible (global) ·
  disabled — nicht Teil der Konstante, einzelne Aufrufer ergänzen
  `disabled:opacity-50` selbst (z. B. `DbInfoPanel.tsx:128`). active/loading —
  nicht vorhanden.

Verwendung: `src/lib/ui.ts:22,26`; groß in `src/App.tsx:1382` (Bestätigungs-
dialog „Zurück"), `src/components/EntryForm.tsx:708` („Abbrechen"),
`src/components/SeriesScopeDialog.tsx:73` („Abbrechen"),
`src/components/PrintReportPanel.tsx`; kompakt in
`src/views/CalendarPage.tsx:81`, `src/components/AboutPanel.tsx:67,75`,
`src/components/AppointmentAgenda.tsx:221`, `src/components/DbInfoPanel.tsx:128`,
`src/components/AppointmentMonthGrid.tsx:138`, `src/components/ObjectionEditor.tsx:58`,
`src/components/RecoveryCodeReveal.tsx:56`, `src/components/ReminderSettings.tsx:97`,
`src/components/SecurityPanel.tsx:165`.

## Danger (bg-danger)

Tokens:
  Fläche/Text: `bg-danger text-on-primary`, `hover:bg-danger-hover`
  Form/Größe: `rounded px-4 py-2 text-sm font-medium` (App.tsx:1389) bzw.
    `rounded px-3 py-1.5 text-sm font-medium` + `disabled:opacity-50`
    (SecurityPanel.tsx:313)
  focus: kein lokales `focus-visible:` — globaler Ring

Zustände: default · hover (`hover:bg-danger-hover`) · focus-visible (global) ·
  disabled (nur SecurityPanel.tsx:313, `opacity-50`). active/loading — nicht
  vorhanden.

Verwendung: `src/App.tsx:1389` (Bestätigungsdialog, destruktive Aktion
„Löschen"/„Verwerfen"); `src/components/SecurityPanel.tsx:313`.

## Warn-Aktion (bg-warning-action, solid + Ghost)

Tokens:
  Solid: `rounded bg-warning-action px-3 py-1 text-xs font-medium
    text-on-primary hover:bg-warning-action-hover` (EntryForm.tsx:690,
    „Trotzdem speichern")
  Ghost/Outline: `rounded border border-warning-action-line px-3 py-1
    text-xs hover:bg-warning-action-ghost-hover` (EntryForm.tsx:683,
    „Zeiten prüfen")
  Drift: `DbInfoPanel.tsx:232` nutzt denselben Ghost-Rahmen
    (`border-warning-action-line`), aber `hover:bg-warning-banner-hover`
    statt `hover:bg-warning-action-ghost-hover` — reale Abweichung, hier nur
    dokumentiert, nicht bereinigt.
  focus: kein lokales `focus-visible:` — globaler Ring

Zustände: default · hover (siehe oben, je Variante) · focus-visible (global).
  disabled/active/loading — nicht vorhanden.

Verwendung: `src/components/EntryForm.tsx:683,690` (Überschneidungswarnung im
Terminformular); `src/components/DbInfoPanel.tsx:232` (Ghost-Variante mit
abweichendem Hover-Ton).

## Outline-Primär (LockScreen)

Tokens:
  Rahmen/Text: `border border-primary-outline text-primary-outline-ink`,
    `hover:bg-primary-outline-hover`
  Vollständige Klasse (LockScreen.tsx:360): `flex min-h-touch w-full
    items-center justify-center gap-2 rounded border border-primary-outline
    px-4 py-2 text-sm font-medium text-primary-outline-ink
    hover:bg-primary-outline-hover disabled:opacity-50`
  height/touch: `min-h-touch` — einziger Primär/Outline-Button mit
    garantierter Touch-Mindesthöhe auf allen Breakpoints (kein `sm:min-h-0`)
  focus: kein lokales `focus-visible:` — globaler Ring

Zustände: default · hover · focus-visible (global) · disabled
  (`disabled:opacity-50`, gesteuert über `bioBusy`). active/loading — kein
  Spinner; der Label-Text wechselt auf „Wird geprüft…" (analog zum
  Primär-Button-Ladezustand).

Verwendung: `src/views/LockScreen.tsx:360` (Fingerabdruck-Entsperren,
einzige Fundstelle dieser vollständigen Button-Kombination). Der reine
Textton `text-primary-outline-ink` wird davon losgelöst zusätzlich als
Textfarbe verwendet (kein Button): `src/components/DbInfoPanel.tsx:145`
(Badge-Text), `src/components/BottomNav.tsx:36` (aktiver Tab),
`src/views/LockScreen.tsx:450` (Link).

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-primary`/`primary-hover`, `bg-danger`/`danger-hover`, `warning-action`/
`warning-action-hover`/`warning-action-line`/`warning-action-ghost-hover`,
`primary-outline`/`primary-outline-ink`/`primary-outline-hover`,
`border-strong`, `surface-2`, `on-primary`, `text-primary-ink` — alle in
`tailwind.config.js` (`theme.extend.colors`) definiert und auf
`var(--color-*)` in `src/tokens.css` gemappt. `min-h-touch`/
`min-h-touch-pointer` in `tailwind.config.js` (`theme.extend.minHeight`).
Der globale Fokusring stammt aus `src/styles.css:22-25`.
