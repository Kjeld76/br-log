# Chip

Anatomie: Zwei unabhängige Chip-Familien: `TagChip` (Schlagwort-Chip,
`src/components/TagChip.tsx`, drei Varianten `selectable`/`removable`/
`readonly`) und die Termin-Farbchips (`.appt-chip-*`/`.appt-dot-*` in
`src/styles.css`, Zuordnung über `chipClsFor`/`dotClsFor` in
`src/lib/appointmentUi.ts`). Kein gemeinsames Basis-Component zwischen beiden
Familien — TagChip ist ein React-Component, die Termin-Chips sind reine
CSS-Klassen, die per Funktionsaufruf ausgewählt werden.

## TagChip (`src/components/TagChip.tsx`)

Tokens je Variante:
  `readonly` (Zeile 27): `rounded-full bg-surface-2 px-2 py-0.5 text-xs
    text-primary-ink` — kein Rahmen, kein interaktives Element (reines `<span>`)
  `selectable` — aktiv (Zeile 63): `border-primary bg-primary text-on-primary`;
    inaktiv (Zeile 64): `border-border-strong bg-surface text-secondary-ink
    hover:bg-surface-2`; beide: `rounded-full border px-3 py-1 text-xs
    transition`
  `removable` — archiviert (Zeile 39): `bg-archived-surface`; aktiv
    (Zeile 39): `bg-primary`; beide: `inline-flex items-center gap-1
    rounded-full px-2.5 py-1 text-xs text-on-primary`; „×"-Entfernen-Button:
    `text-on-primary/80 hover:text-on-primary`, archiviert zusätzlich
    Text-Suffix „(archiviert)" mit `opacity-80`
  focus: keine lokale `focus-visible:`-Klasse in TagChip.tsx — der
    `selectable`-Button und der `removable`-„×"-Button erhalten ihren
    Fokusring ausschließlich vom globalen `:focus-visible` aus
    `styles.css:22-25`
  height/touch: keine `min-h-touch`-Klasse in einer der drei Varianten

Zustände: `selectable` — default (inaktiv) · hover (`hover:bg-surface-2`,
  nur inaktiv) · active-ausgewählt (`bg-primary`, kein Hover-Unterschied
  definiert) · focus-visible (global). `removable` — default/archiviert ·
  disabled (`disabled`-Prop am „×"-Button, aber keine visuelle
  `disabled:`-Utility — kein sichtbarer Unterschied außer Cursor/Browser-
  Default) · focus-visible (global, nur am „×"-Button). `readonly` — nur
  default, kein interaktiver Zustand (kein Button/Klick-Handler). loading —
  bei keiner Variante vorhanden.

Verwendung: `readonly` in `src/components/EntryList.tsx:280`,
`src/components/EntryDetail.tsx:52`, `src/components/AppointmentDetail.tsx:93`;
`removable` (mit `archived`-Prop) in `src/components/EntryForm.tsx:505-512`,
`src/components/AppointmentForm.tsx:543,581,594`; `selectable` in
`src/components/EntryForm.tsx:531-537`, `src/components/TagFilterChips.tsx:31`.

## Filter-Chip (Zeitraum-Disclosure, `EntryList.tsx:158-172`, kein TagChip)

Datums-Zeitraum sitzt seit dem Historie-Redesign (Design-Handoff #27, 1d)
hinter einem Chip/Disclosure statt zweier dauerhaft sichtbarer Datumsfelder
-- Schlagwort-Filter (`TagFilterChips`) bleiben unabhängig davon sichtbar.
Bewusst **kein** `TagChip variant="selectable"`-Aufruf: `TagChip.label` ist
ein reiner String-Prop, kann also kein Icon vor dem Text rendern -- daher ein
lokal ausgeschriebener Button, der die `selectable`-Farbklassen 1:1
übernimmt (kein neues Token, keine neue Farbe):

Tokens:
  Aktiv (Zeitraum gesetzt): `border-primary bg-primary text-on-primary` --
    identisch zum aktiven `TagChip variant="selectable"`
  Inaktiv: `border-border-strong bg-surface text-secondary-ink
    hover:bg-surface-2` -- identisch zum inaktiven `TagChip
    variant="selectable"`
  Form: `rounded-full border px-3 py-1 text-xs transition` (wie TagChip) +
    `inline-flex items-center gap-1.5` fürs Icon
  Inhalt: `Icon name="filter" size={13}` + Label. Das Label zeigt den
    **aktiven** Zeitraum direkt am Chip an (`12.03.–18.03.`, `ab 12.03.` oder
    `bis 18.03.`, Kurzform ohne Wochentag/Jahr) statt nur „Filter" -- ein
    wirksamer, aber eingeklappter Datumsfilter muss laut Auftrag am Chip
    selbst erkennbar bleiben (sonst Bedienfehler-Risiko: der Nutzer merkt
    nicht, dass die Liste bereits gefiltert ist).
  a11y: `aria-expanded` + `aria-controls` (Disclosure-Muster, analog zum
    Widerspruchs-Abschnitt in `EntryForm.tsx`)
  height/touch: `min-h-touch-pointer` (44px) -- anders als beim
    `TagChip`-Original (keine Touch-Mindesthöhe, s. o.), hier bewusst
    ergänzt.
  focus: kein lokales `focus-visible:` -- globaler Ring aus `styles.css:22-25`

Zustände: aktiv/inaktiv (s. o.) · hover (nur inaktiv) · focus-visible
  (global) · aufgeklappt/eingeklappt (`aria-expanded`). disabled/loading —
  nicht vorhanden.

Verwendung: `src/components/EntryList.tsx:158-172` (Trigger),
`EntryList.tsx:175-207` (aufklappbares Panel mit den beiden Datumsfeldern +
„Zeitraum löschen"), einzige Fundstelle dieses Musters.

## Termin-Farbchips (`.appt-chip-*`/`.appt-dot-*`, `src/styles.css:87-122`)

Tokens:
  Fünf Farbtöne, geschlossene Liste (`sky` = Standard, `emerald`, `amber`,
    `rose`, `violet`), definiert in `src/lib/appointmentUi.ts:25-56`
    (`COLOR_OPTIONS`)
  Chip-Fläche/-Text (z. B. `.appt-chip-sky`, `styles.css:87-90`): `background:
    var(--color-appt-sky-bg); color: var(--color-appt-sky-ink);` — reine
    CSS-Regeln, kein Tailwind-Utility; Verbrauch über `chipClsFor(color)`
    als zusätzliche Klasse neben Tailwind-Utilities, z. B.
    `"shrink-0 rounded px-1.5 py-0.5 text-xs " + chipClsFor(color)`
    (`OccurrenceListRow.tsx:61`, `AppointmentMonthGrid.tsx:219`)
  Farbpunkt (z. B. `.appt-dot-sky`, `styles.css:108-110`): `background:
    var(--color-appt-sky-dot);` — kräftiger, modusunabhängiger Ton (ein
    Wert statt Light/Dark-Paar, s. Kommentar `tokens.css:142-144`), über
    `dotClsFor(color)` z. B. als `h-3 w-3 rounded-full` in
    `AppointmentDetail.tsx:56` oder als `h-6 w-6 rounded-full` +
    Auswahlring `ring-2 ring-primary-ink ring-offset-1` im Farb-Radiogroup
    des Formulars (`AppointmentForm.tsx:334-348`)
  focus: keine eigene Regel in `.appt-chip-*`/`.appt-dot-*` — wo die Farbe
    auf einem interaktiven Element sitzt (Farb-Radiobutton im Formular),
    greift der globale `:focus-visible`-Ring
  height/touch: nicht zutreffend (reine Farbflächen, keine eigenständige
    Höhen-/Touch-Vorgabe)

Zustände: nur „welche Farbe" (fünf feste Ausprägungen je Chip/Dot) — kein
  Hover/Active/Disabled/Loading auf der Farbklasse selbst; interaktive
  Zustände (Hover/Fokus/Ring) gehören zum jeweiligen Trägerelement (Button,
  Zeile), nicht zur Chip-Farbklasse.

Verwendung: `chipClsFor` in `src/components/OccurrenceListRow.tsx:61`,
`src/components/AppointmentMonthGrid.tsx:219`; `dotClsFor` in
`src/components/AppointmentDetail.tsx:56`; `COLOR_OPTIONS`
(Farbauswahl-Radiogroup) in `src/components/AppointmentForm.tsx:331-349`.

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-surface-2`, `text-primary-ink`, `border-primary`, `bg-primary`,
`text-on-primary`, `border-border-strong`, `bg-surface`, `text-secondary-ink`,
`bg-archived-surface` — alle in `tailwind.config.js` (`theme.extend.colors`)
definiert. `.appt-chip-sky/emerald/amber/rose/violet` und
`.appt-dot-sky/emerald/amber/rose/violet` als CSS-Klassen in
`src/styles.css:87-122` definiert, referenzieren `--color-appt-*-bg/-ink/-dot`
aus `src/tokens.css:136-149` (Light) und `tokens.css:254-258` (Dark).
