# Input

Anatomie: Drei unabhängige Eingabefeld-Ausprägungen ohne gemeinsames
`<Input>`-Component: der Standard-Feld-String `inputCls` (`src/lib/ui.ts`),
die vertrauliche Textarea/Input-Klasse `.confidential-input` (`src/styles.css`,
BR-Geheimnis-Kontext) und das Login-Eingabefeld in `LockScreen`/`SecurityPanel`
(eigener, undokumentiert dupliziert vorliegender Klassenstring). `lib/ui.ts:12-15`
begründet die Trennung explizit: LockScreen/SecurityPanel haben „einen
eigenen Login-Look mit fokussiertem Rahmen in sky-500 statt Standard-Rahmen".

## Standard (inputCls, `src/lib/ui.ts:18-19`)

Tokens:
  Klasse: `rounded border border-border-strong bg-surface-input p-2 text-sm
    text-primary-ink placeholder:text-disabled-ink`
  Fläche: `bg-surface-input` (hell = weiß wie `surface`, dunkel eine Stufe
    heller abgesetzt, s. Kommentar `tokens.css:15`)
  Rahmen: `border-border-strong`
  height/touch: keine `min-h-touch`-Ergänzung an den geprüften Aufrufstellen
    (`CalendarPage.tsx:91`, `AppointmentForm.tsx:213,411,478,510`,
    `AppointmentAgenda.tsx:144`, `PrintReportPanel.tsx:110`,
    `EntryList.tsx:183,190`, `TagManager.tsx:80,166`, `ObjectionEditor.tsx:29,37,44`,
    `ExportPanel.tsx:217`, `EntryForm.tsx:333`, `StatsView.tsx:65`) — die
    Konstante selbst definiert keine Mindesthöhe, nur `p-2` Padding. Eine
    Ausnahme: `EntryList.tsx:131` (großes Suchfeld, s. u.) ergänzt lokal
    `h-[46px]`.
  focus: kein `outline-none`/lokales `focus:`-Styling in der Konstante —
    damit greift ungehindert der globale `:focus-visible`-Ring aus
    `src/styles.css:22-25` (`outline: var(--focus-width) solid
    var(--color-focus-ring)`)

Zustände: default · focus-visible (global) · disabled — einzelne Aufrufer
  ergänzen `disabled={...}` am Element (z. B. EntryForm.tsx: Freizeitausgleich-
  Textareas), aber `inputCls` selbst trägt keine `disabled:`-Utility (kein
  visueller Disabled-Stil außer Browser-Default). hover/active/loading —
  nicht vorhanden.

Verwendung: `src/lib/ui.ts:18-19`; u. a. `src/components/EntryForm.tsx:333`,
`src/components/EntryList.tsx:131,183,190`, `src/components/AppointmentForm.tsx:213`,
`src/components/TagManager.tsx:80,166`, `src/components/ObjectionEditor.tsx:29,37,44`,
`src/components/ExportPanel.tsx:217`, `src/components/PrintReportPanel.tsx:110`,
`src/views/CalendarPage.tsx:91`, `src/views/StatsView.tsx:65`,
`src/components/AppointmentAgenda.tsx:144`.

### Variante: große Suche mit Icon (`EntryList.tsx:124-137`, Design-Handoff #27, 1d)

Historie-Volltextsuche ist seit dem Historie-Redesign das erste, größte
Element der Filterleiste statt eines kleinen Felds neben dem „+ Neuer
Eintrag"-Button. Keine neue Klassen-Konstante, sondern `inputCls` lokal um
zwei Utilities erweitert:

Tokens:
  Klasse: `inputCls + " h-[46px] w-full pl-10"` -- `h-[46px]` ist ein
    arbiträrer Wert, aber explizit durch die Spec vorgegeben
    ("~46 px hohes Feld"), daher laut CLAUDE.md-Direktive zulässig
  Icon: `Icon name="search" size={18}` in einem umschließenden `relative`-
    Wrapper, absolut positioniert (`absolute left-3 top-1/2
    -translate-y-1/2 text-disabled-ink`, `pointer-events-none` -- Klicks
    gehen durch zum Feld). `pl-10` am Input schafft den nötigen Freiraum,
    damit der Text das Icon nicht überlappt.
  a11y: `aria-label="Volltextsuche"` zusätzlich zum (langen, informativen)
    Platzhaltertext.
  focus: unverändert global (s. o.) -- das Icon liegt optisch über dem
    Feld, nimmt aber am Fokus-Ring nichts weg (`pointer-events-none`,
    kein eigenes Tab-Ziel).

Verwendung: `src/components/EntryList.tsx:124-137`, einzige Fundstelle
dieses Musters.

## Vertraulich (.confidential-input, `src/styles.css:50-61`)

Tokens:
  Klasse (CSS, nicht Tailwind-Utility): `width: 100%; border-radius: 0.375rem;
    border: 1px solid var(--color-confidential-border); background:
    var(--color-confidential-input-bg); color:
    var(--color-confidential-input-ink); padding: 0.5rem; font-size: 0.875rem;`
  Placeholder: `::placeholder { color: var(--color-confidential-placeholder); }`
  Rahmen/Fläche/Text bewusst eigenständig rot/rosé getönt (Light wie Dark),
    um sich von der neutralen GL-Sicht abzuheben (Kommentar `styles.css:36-43`)
  height/touch: keine Mindesthöhe definiert
  focus: keine eigene Fokus-Regel in `.confidential-input` — der globale
    `:focus-visible`-Ring aus `styles.css:22-25` greift unverändert (kein
    Override, anders als beim Login-Input unten)

Zustände: default · focus-visible (global) · disabled — Aufrufer setzen
  `disabled={draft.isCompensation}` am Element (EntryForm.tsx:637,
  AppointmentForm.tsx), aber die Klasse selbst definiert keinen
  Disabled-Stil. hover/active/loading — nicht vorhanden.

Sichtschutz (Issue #17, Task 8, Desktop-only): beide Textareas tragen
  zusätzlich `confidential-blur` (`className="confidential-input
  confidential-blur"`) — `html[data-window-blurred] .confidential-blur {
  filter: blur(7px); }` in `styles.css`, App.tsx setzt/entfernt das
  Attribut auf `<html>` bei window blur/focus (Einstellung „Sichtschutz bei
  Fensterfokus-Verlust" in SecurityPanel, Default AN). Rein visuell — der
  Blur blockiert keine Tastaturbedienung/kein `pointer-events`, keine
  Transition (reduced-motion-neutral per Konstruktion).

Verwendung: `src/components/EntryForm.tsx:632` (Textarea „Vertrauliche
Tätigkeitsbeschreibung"), `src/components/AppointmentForm.tsx:632`.

## Login-Input (LockScreen/SecurityPanel)

Tokens:
  Klasse (identisch dupliziert an zwei Stellen): `w-full rounded border
    border-border-strong bg-login-input px-3 py-2 text-sm text-primary-ink
    outline-none focus:border-focus`
  Fläche: `bg-login-input` (eigener Token, hell `#ffffff`, dunkel
    `#0f172a` — dunkler als `surface-input`, s. `tokens.css:68,216,303`)
  focus: **weicht bewusst vom globalen Muster ab** — `outline-none` schaltet
    den globalen `:focus-visible`-Ring aus `styles.css:22-25` explizit ab;
    stattdessen wechselt bei `:focus` (nicht `:focus-visible`) nur die
    Rahmenfarbe auf `border-focus`. Kein Ring/Outline, kein Offset — der
    einzige Eingabefeld-Typ in der App ohne den globalen Fokusring.
  height/touch: keine `min-h-touch`-Klasse

Zustände: default · focus (Rahmenfarbe, kein Ring) · disabled (`locked`-Prop
  bei Wiederherstellungscode-Feld, `disabled={locked}`, kein visueller
  Disabled-Stil in der Klasse selbst). hover/active/loading — nicht
  vorhanden. focus-visible (global) — nicht vorhanden (bewusst durch
  `outline-none` unterdrückt).

Verwendung: `src/views/LockScreen.tsx:182-183,384` (Passwort-/
Wiederherstellungscode-Feld), `src/components/SecurityPanel.tsx:161-162`
(identischer Klassenstring, eigenständig dupliziert statt importiert).

## Verifikation der Utilities (Grep-Gegenprobe)

`border-strong`, `surface-input`, `text-primary-ink`, `disabled-ink`,
`login-input`, `focus` (Farbe) — alle in `tailwind.config.js`
(`theme.extend.colors`) definiert. `--color-surface-input`,
`--color-login-input`, `--color-confidential-border`,
`--color-confidential-input-bg`, `--color-confidential-input-ink`,
`--color-confidential-placeholder`, `--color-focus-ring` — alle in
`src/tokens.css` (Root + Dark-Block) vorhanden. `.confidential-input` als
reine CSS-Klasse in `src/styles.css:50-61` definiert (kein Tailwind-Utility).
