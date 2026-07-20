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
versuchen"; `src/components/EntryForm.tsx:342,717`; `src/components/EntryList.tsx:141-147`
(„+ Neuer Eintrag", nur `!mobile` -- am Desktop bleibt der Button oben, s.
Abschnitt „FAB" unten); `src/components/AppointmentForm.tsx:659`;
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
`src/views/CalendarPage.tsx:84` („Heute"), `src/components/AboutPanel.tsx:67,75`,
`src/components/AppointmentAgenda.tsx:221`, `src/components/DbInfoPanel.tsx:128`,
`src/components/ObjectionEditor.tsx:58`,
`src/components/RecoveryCodeReveal.tsx:56`, `src/components/ReminderSettings.tsx:97`,
`src/components/SecurityPanel.tsx:165`.
Ehemals auch `AppointmentMonthGrid.tsx` (Monats-Vor-/Zurück): seit der
stabilen Kalender-Kopfzeile (#27, 1c) sind die beiden Textbuttons „‹
Vorheriger"/„Nächster ›" durch die neuen Icon-Only-Pfeilbuttons ersetzt
(siehe eigener Abschnitt „Icon-Only (Kalender-Monatspfeile)" unten) --
`secondaryBtnSmCls` wird dort nicht mehr verwendet.

## Icon-Only (Kalender-Monatspfeile, `AppointmentMonthGrid.tsx`)

Tokens:
  Rahmen/Text: `border border-border-strong text-primary-ink`,
    `hover:bg-surface-2` (optisch verwandt mit dem Sekundär-Button, aber
    quadratisch statt Text-Padding)
  Form/Größe: `rounded`; feste 44×44px -- Breite kommt aus der
    Grid-Spalte (`grid-cols-[44px_1fr_44px]`, Button selbst `w-full`),
    Höhe über `min-h-touch-pointer` (44px, `--touch-pointer`). KEINE
    `sm:`-Reduktion -- die Pfeile bleiben auf allen Breiten 44px, damit sie
    nie die Position wechseln.
  Inhalt: `Icon name="chevron-right" size={20}`, Zurück-Pfeil gespiegelt via
    `rotate-180` (kein eigenes Asset).
  a11y: `aria-label="Vorheriger Monat"`/„Nächster Monat" (kein sichtbarer
    Text mehr, Label rein für Screenreader).
  focus: kein lokales `focus-visible:` — globaler Ring aus `styles.css:22-25`

Zustände: default · hover (`hover:bg-surface-2`) · focus-visible (global).
  disabled/active/loading — nicht vorhanden.

Verwendung: `src/components/AppointmentMonthGrid.tsx` (Monatsnavigation,
einzige Fundstelle dieses Musters).

## FAB (Historie „+ Neuer Eintrag", `EntryList.tsx`, nur Android)

Tokens:
  Fläche/Text: `bg-primary text-on-primary`, `hover:bg-primary-hover` --
    dieselbe Primär-Farbfamilie wie der Standard-Primär-Button oben, nur als
    Kreis statt Text-Pille.
  Form/Größe: `rounded-full`, feste `h-14 w-14` (56×56px, Vorgabe aus dem
    Design-Handoff #27, 1d). Inhalt: `Icon name="plus" size={24}`, kein
    sichtbarer Text.
  Position: `fixed bottom-20 right-4 z-sticky` -- bildschirmfest in der
    Daumenzone, unabhängig vom Scroll-Container. `bottom-20` (5rem/80px,
    Tailwind-Skalenwert; ersetzt seit dem #27-Review-Fix das vormals
    geratene `bottom-[5.5rem]`/88px) hält bewusst mehr Abstand als die
    BottomNav braucht (real ca. 68-70px hoch) -- ein zusätzliches
    Sicherheitspolster (Material-FAB-Gutter, ca. 10-16px), damit der FAB die
    Leiste auch bei größerer Systemschrift nie verdeckt. Seit BottomNav kein
    `fixed`-Overlay mehr ist, sondern reell Platz im Layout einnimmt (s.
    Kommentar in `BottomNav.tsx`), muss der FAB dafür keine Rücksicht mehr
    auf ein Scroll-Padding an `main` nehmen -- er ist ohnehin `fixed` und
    damit unabhängig vom Scroll-Container positioniert.
  a11y: `aria-label="Neuer Eintrag"` + `title` (kein sichtbarer Text).
  focus: lokal `focus-visible:outline focus-visible:outline-2
    focus-visible:outline-offset-2 focus-visible:outline-focus` (dupliziert
    statt global, weil der Button außerhalb des normalen Dokumentflusses
    `fixed` positioniert ist).
  height/touch: `h-14 w-14` = 56px, deutlich über `min-h-touch` (48px).

Zustände: default · hover (`hover:bg-primary-hover`) · focus-visible (lokal,
  s. o.). disabled/active/loading — nicht vorhanden.

Verwendung: `src/components/EntryList.tsx:337-347`, nur wenn `mobile` true
ist (Android); am Desktop bleibt stattdessen der Standard-Primär-Button oben
in der Suchzeile (s. o., „Primär").

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
(Badge-Text), `src/components/BottomNav.tsx:55` (aktiver Tab),
`src/views/LockScreen.tsx:450` (Link).

## ActionRow + Empfohlen-Callout (`ExportPanel.tsx`)

Tokens:
  ActionRow (`ExportPanel.tsx:33-83`, lokale Komponente): kompakte
    Icon-Titel-Chevron-Zeile, ersetzt frühere Vollbreite-Buttons mit langen
    Beschreibungsblöcken (Design-Handoff #27, 1f). Klasse: `flex min-h-touch
    w-full items-center gap-3 rounded border border-empty-line bg-surface
    px-4 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50`; Titel
    `block text-sm font-medium text-primary-ink`, optionaler Untertitel
    `block text-xs text-secondary-ink` (+ `truncate`, außer bei
    `wrapSubtitle`, s. u.), abschließendes `chevron-right`-Icon.
  `wrapSubtitle`-Prop (Finding #27-Review): sicherheitsrelevante Untertitel
    (z. B. „(BR-Geheimnis bleibt geschützt)" bei den CSV-Export-Zeilen)
    dürfen bei 360px nicht per `truncate` abgeschnitten werden -- die Prop
    lässt den Untertitel stattdessen normal umbrechen. Gesetzt bei
    `ExportPanel.tsx` GL- und Voll-CSV-Zeile, alle übrigen `ActionRow`-
    Aufrufe behalten das `truncate`-Standardverhalten.
  Empfohlen-Callout (`ExportPanel.tsx:232-269`, kein `ActionRow`-Aufruf,
    eigener Button): einzige hervorgehobene Zeile des Panels -- optisch wie
    ein Info-Banner (`border-info-ink bg-info-badge`, s. error-box.md),
    strukturell aber ein anklickbarer Button wie `ActionRow` (`flex
    min-h-touch w-full items-start gap-3 rounded-lg ... text-left
    disabled:opacity-50`). Trägt zusätzlich eine „Empfohlen"-Pille
    (`rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-info-ink`)
    und -- nur `mobile` -- einen eigenen Warnhinweis-Block
    (`bg-warning-banner`, s. error-box.md) zum Datenverlust bei
    Deinstallation.
  focus: kein lokales `focus-visible:` an beiden Mustern -- globaler Ring aus
    `styles.css:22-25`
  height/touch: `min-h-touch` (48px) an beiden

Zustände: default · hover (`hover:bg-surface-2`, nur `ActionRow`) ·
  focus-visible (global) · disabled (`disabled:opacity-50`, beide, gesteuert
  über `busy`). active/loading — nicht vorhanden.

Verwendung: `ActionRow` in `src/components/ExportPanel.tsx:271-277`
(JSON-Import), `:324-346` (CSV-GL/-Voll, ICS-Export), `:370-376`
(ICS-Import); Empfohlen-Callout einzige Fundstelle
`src/components/ExportPanel.tsx:232-269` (JSON-Backup).

## Icon-Button-Trio (`AppointmentDetail.tsx:126-154`)

Tokens:
  Drei gleich breite Icon-über-Label-Buttons (Zeit buchen/Duplizieren/
  Löschen) in einer festen Reihe -- ersetzt die frühere Reihe aus
  Text-Buttons, die auf 360px zusammen mit „Bearbeiten"/„Schließen" zu einem
  gedrängten Block umbrach (Design-Handoff #27, 1g; „Schließen" ist seither
  das X im Modal-Kopf, s. modal.md). Klasse (Zeit buchen/Duplizieren):
  `flex min-h-touch-pointer flex-1 flex-col items-center justify-center
  gap-1 rounded-lg border border-border-strong px-2 py-2 text-xs
  text-primary-ink hover:bg-surface-2`; Löschen identisch, aber
  `text-destructive-ink hover:bg-destructive-hover` statt der neutralen
  Text-/Hover-Farbe -- einzige rote Aktion der Reihe, aber (anders als vor
  #27) nicht mehr direkt neben „Bearbeiten".
  „Bearbeiten" darunter ist der Standard-Primär-Button (volle Breite,
  `min-h-touch`, s. Abschnitt „Primär" oben) -- kein Teil des Trios selbst.
  focus: kein lokales `focus-visible:` -- globaler Ring aus `styles.css:22-25`
  height/touch: `min-h-touch-pointer` (44px) an allen drei Trio-Buttons,
    `min-h-touch` (48px) am „Bearbeiten"-Button darunter

Zustände: default · hover (je Button, s. o.) · focus-visible (global).
  disabled/active/loading — nicht vorhanden.

Verwendung: `src/components/AppointmentDetail.tsx:126-162`, einzige
Fundstelle dieses Musters (Termin-Detailansicht).

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-primary`/`primary-hover`, `bg-danger`/`danger-hover`, `warning-action`/
`warning-action-hover`/`warning-action-line`/`warning-action-ghost-hover`,
`primary-outline`/`primary-outline-ink`/`primary-outline-hover`,
`border-strong`, `surface-2`, `on-primary`, `text-primary-ink` — alle in
`tailwind.config.js` (`theme.extend.colors`) definiert und auf
`var(--color-*)` in `src/tokens.css` gemappt. `min-h-touch`/
`min-h-touch-pointer` in `tailwind.config.js` (`theme.extend.minHeight`).
Der globale Fokusring stammt aus `src/styles.css:22-25`.
