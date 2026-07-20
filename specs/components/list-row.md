# List-Row

Anatomie: Zwei unabhängige Zeilen-Muster ohne gemeinsame Basis: die
Termin-Zeile `OccurrenceListRow` (eigene Component, zwei Varianten `card`/
`panel`) und die Eintrags-Zeile in `EntryList` (kein eigenes Component, Zeile
direkt im `.map()` der Liste ausgeschrieben). Beide sind `<li role="button"
tabIndex={0}>` mit `onClick`+`onKeyDown` (Enter/Leertaste aktivieren) statt
eines nativen `<button>` — deshalb tragen beide ihr Fokus-Styling lokal statt
sich auf natives Button-Verhalten zu verlassen.

## OccurrenceListRow (`src/components/OccurrenceListRow.tsx`)

Tokens:
  Rahmen (beide Varianten): `border border-border`
  Fläche `card`: zusätzlich `bg-surface` (eigenständige Karte, z. B. Agenda-
    Suchtreffer); Fläche `panel`: kein eigenes `bg-*` (sitzt bereits in einem
    Container mit eigener Fläche, z. B. Tages-Panel des Monatsrasters)
  Hover (beide): `hover:bg-surface-2` — **kein** Akzent-Rahmen/-Fläche (anders
    als EntryList, s. u.)
  Chip: `chipClsFor(color)` aus `src/lib/appointmentUi.ts` → `.appt-chip-*`
    (s. chip.md), `shrink-0 rounded px-1.5 py-0.5 text-xs`
  Wichtig-Marker: reines `!`-Präfix mit `font-semibold`, kein Farb-Token
  Vertraulich-Treffer: `text-confidential` (CSS-Klasse aus `styles.css`,
    nicht Tailwind-Utility) + Schloss-Icon
  focus: lokal `focus-visible:outline focus-visible:outline-2
    focus-visible:outline-offset-2 focus-visible:outline-focus`
    (`OccurrenceListRow.tsx:29-31`) — dieselbe Farbe/Breite/Offset wie der
    globale `:focus-visible`-Ring aus `styles.css:22-25`, aber als
    Klassen-Selektor mit höherer Spezifität lokal dupliziert (nötig, weil
    `<li>` kein natives Fokus-Outline-Verhalten wie `<button>` hat)
  height/touch: keine `min-h-touch`-Klasse an der Zeile selbst

Zustände: default · hover (`hover:bg-surface-2`) · focus-visible (lokal
  dupliziert, s. o.) · aktiviert per Klick/Enter/Leertaste
  (`onKeyDown`-Handler). disabled/loading — nicht vorhanden (die Zeile ist
  immer interaktiv, es gibt keinen deaktivierten Zustand). active/pressed —
  nicht vorhanden (kein `:active`-Styling).

Verwendung: `src/components/OccurrenceListRow.tsx:28-32` (Varianten-Definition
`FRAME`), eingesetzt u. a. in `AppointmentAgenda`/`AppointmentMonthGrid`
(Tages-Panel: `variant="panel"`) und Agenda-Suchtreffern (`variant="card"`,
Default).

## EntryList-Zeile (`src/components/EntryList.tsx:238-315`)

Tokens:
  Rahmen/Fläche: `rounded border border-border bg-surface p-3`
  Hover-Akzent-Muster (abweichend von OccurrenceListRow): `hover:border-hover-accent-line
    hover:bg-hover-accent-surface-soft` — Rahmenfarbe UND Fläche wechseln beim
    Hover auf die Akzent-Token (`--color-hover-accent-line`,
    `--color-hover-accent-surface-soft`), nicht nur die neutrale
    `surface-2`-Fläche
  Innere Reihenfolge seit dem Historie-Redesign (Design-Handoff #27, 1d):
    Anker-Zeile Datum + Uhrzeit oben (Duration bleibt rechts daneben, s. u.),
    darunter die Info (`truncate`, einzeilig), darunter EINE gemeinsame
    Pillen-Zeile mit Tags + allen Status-Badges (vorher: Status-Badges inline
    mit dem Datum, Tags in einer eigenen Zeile darunter, Info zuletzt --
    „Badges einheitlich als Pillen" ersetzt diese Mischung durch eine
    konsistente Reihenfolge)
  Status-Badges in der Pillen-Zeile (s. auch error-box.md): `rounded-full
    bg-success-surface text-success-ink` (Freizeitausgleich), `rounded-full
    bg-warning-badge text-warning-badge-ink` (keine geplante Schicht),
    `rounded-full bg-error-badge text-error-badge-ink` (Widerspruch-Zähler)
    — alle drei jetzt einheitlich `rounded-full` (vorher trugen die ersten
    beiden nur `rounded`, der Objections-Badge war bereits `rounded-full`;
    Design-Handoff #27, 1d: „Badges einheitlich als kleine Pillen")
  Tags: `TagChip variant="readonly"` (s. chip.md), Teil derselben Pillen-Zeile
  Vertraulich-Treffer: `text-confidential` (identisches Muster wie
    OccurrenceListRow), steht als letztes Element der Karte (nach der
    Pillen-Zeile)
  focus: lokal `focus-visible:outline focus-visible:outline-2
    focus-visible:outline-offset-2 focus-visible:outline-focus`
    (`EntryList.tsx:242`) — identisches Muster/Token wie OccurrenceListRow,
    unabhängig dupliziert (kein gemeinsamer Import)
  height/touch: keine `min-h-touch`-Klasse

Zustände: default · hover (Akzent-Rahmen + -Fläche, s. o.) · focus-visible
  (lokal dupliziert) · aktiviert per Klick/Enter/Leertaste. Leerzustand:
  eigene Zeile `border-dashed border-empty-line` („Keine Einträge
  gefunden.", `EntryList.tsx:321`) — kein interaktives Element, nur Hinweis.
  disabled/loading/active — nicht vorhanden.

Verwendung: `src/components/EntryList.tsx:238-315` (Haupt-Listenansicht der
Einträge, inkl. Duration-Summe rechts, Tag-Chips, Objections-Badge). Die
Suchleiste darüber (großes Suchfeld, Filter-Chip/Disclosure) und der FAB
darunter sind kein List-Row-Muster, s. `input.md`/`chip.md`/`button.md`.

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-surface`, `border-border`, `surface-2`, `hover-accent-line`,
`hover-accent-surface-soft`, `focus` (Farbe), `success-surface`/`success-ink`,
`warning-badge`/`warning-badge-ink`, `error-badge`/`error-badge-ink`,
`border-empty-line` — alle in `tailwind.config.js` (`theme.extend.colors`)
definiert und auf `--color-*` in `src/tokens.css` gemappt. `.text-confidential`
als CSS-Klasse in `src/styles.css:63-65` definiert.
