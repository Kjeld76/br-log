# Modal

Anatomie: Kein `<Modal>`-Component — drei eigenständige, strukturell ähnliche
Overlay-Bausteine in `src/App.tsx` plus ein vierter in einer eigenen Datei:
(1) der Haupt-Modal-Überbau (Formular/Detail/Termin/Einstellungen/Über,
`App.tsx:1187-1347`), (2) `SeriesScopeDialog` (eigene Datei, Drei-Optionen-
Dialog für Serientermine), (3) der Bestätigungsdialog „Verwerfen/Löschen"
(`App.tsx:1362-1397`). Jeder Baustein: äußerer `<div>` = fixiertes
Backdrop (`fixed inset-0 ... bg-overlay`, Klick schließt), innerer `<div
role="dialog" aria-modal="true" tabIndex={-1}>` = das eigentliche Panel
(`bg-surface`, `shadow-xl`, `outline-none`), Klick darauf stoppt Propagation
(`onClick={(e) => e.stopPropagation()}`). Fokus wird über
`useModalFocusTrap` (`src/lib/useModalFocusTrap.ts`) verwaltet.

## Haupt-Modal (App.tsx:1187-1347)

Tokens:
  Backdrop: `bg-overlay` (`var(--color-overlay)`), `z-overlay`
    (`var(--z-overlay)` = 1200)
  Panel: `bg-surface` (weiß/`#1e293b`), `shadow-xl`, `outline-none`
  Breite/Layout: Desktop `my-4 w-full rounded-lg p-4` mit `max-w-2xl`
    (Formular/Detail/Einstellungen) bzw. `max-w-sm` (Über-Dialog); Mobil
    (`mobile === true`) fullscreen-nah: `min-h-full w-full rounded-none p-4`,
    Backdrop-Container dann `items-stretch` statt `items-start`, kein `p-4`
    am Backdrop
  focus: `useModalFocusTrap(modalRef, !!modal, initialFocusRef?)`
    (`App.tsx:250-258`) — fokussiert beim Öffnen entweder das per
    `dateFieldRef` vorgegebene Ziel (Formular-/Terminformular-Modal) oder das
    erste fokussierbare Element (Detail-/Einstellungen-/Über-Modal); hält
    Tab/Shift+Tab im Container. Kein lokales `focus-visible:`-Styling am
    Panel selbst — der Ring auf fokussierten Kindelementen kommt vom
    globalen `:focus-visible` (`styles.css:22-25`).
  Schließen-Icon-Button (Einstellungen/Über): `min-h-touch min-w-touch`
    garantiert Touch-Zielgröße (`App.tsx:1314,1337`)

Zustände: offen (`modal !== null`) · geschlossen. Escape — **nicht
  vorhanden**: es existiert kein `keydown`-Listener in `App.tsx` (per Grep
  über `keydown`/`addEventListener` geprüft, einziger Treffer ist
  `visibilitychange`); Schließen geht ausschließlich über Backdrop-Klick,
  Cancel-/X-Button oder (mobil) die Android-Zurück-Taste
  (`useBackClose`, `App.tsx:984`). disabled/hover/loading — auf Modal-Ebene
  nicht zutreffend (gilt für einzelne Formularelemente, s. button.md/input.md).

Verwendung: `src/App.tsx:1187-1347` (fünf Inhalts-Typen: `form`, `detail`,
`apptForm`, `apptDetail`, `settings`, `about`); Fokusfalle in
`App.tsx:243-258`.

## Bestätigungsdialog (App.tsx:1362-1397)

Tokens:
  Backdrop: `bg-overlay`, `z-modal` (`var(--z-modal)` = 1300 — **eine Ebene
    über** dem Haupt-Modal-Backdrop `z-overlay` = 1200, da der Dialog über
    einem bereits offenen Formular-Modal liegen kann)
  Panel: `w-full max-w-sm rounded-lg bg-surface p-4 shadow-xl outline-none`
  Aktionen: `secondaryBtnCls` („Zurück") + `bg-danger`-Button
    („Verwerfen"/„Löschen", je `confirmLabel`) — s. button.md
  focus: `useModalFocusTrap(confirmRef, !!confirmDiscard)` (App.tsx:259),
    kein `initialFocusRef` — fokussiert das erste fokussierbare Element
    (i. d. R. „Zurück")

Zustände: offen (`confirmDiscard !== null`) · geschlossen. Escape — **nicht
  vorhanden** (gleicher Befund wie beim Haupt-Modal: kein Escape-Listener).
  disabled/hover/loading — nicht zutreffend auf Dialog-Ebene.

Verwendung: `src/App.tsx:1362-1397`; genutzt sowohl für „ungespeicherte
Änderungen verwerfen" als auch „Eintrag löschen" (derselbe Dialog,
`confirmLabel` unterscheidet nur die Beschriftung, s. Kommentar
`App.tsx:1359-1361`).

## SeriesScopeDialog (eigene Datei)

Tokens:
  Backdrop: `bg-overlay`, **`z-40`** — ein roher Tailwind-Standardwert
    (Skalenstufe 40), **kein** Token aus `theme.extend.zIndex`. Damit liegt
    dieser Dialog rechnerisch **unter** dem Haupt-Modal (`z-overlay` = 1200)
    und dem Bestätigungsdialog (`z-modal` = 1300), obwohl der Kommentar
    `App.tsx:1349-1350` ihn ausdrücklich „wie der Bestätigungsdialog über dem
    Detail-Modal" beschreibt. Reale Diskrepanz zwischen Kommentar/Absicht und
    Code, hier nur dokumentiert, nicht behoben.
  Panel: `w-full max-w-sm rounded-lg bg-surface p-4 shadow-xl outline-none`
  Aktionen: drei gestapelte Options-Buttons (`w-full rounded border
    border-border-strong px-4 py-2 text-left text-sm text-primary-ink
    hover:bg-surface-2`) + `secondaryBtnCls` „Abbrechen"
  focus: `useModalFocusTrap(ref, true)` (`SeriesScopeDialog.tsx:23`) — aktiv
    ist hier fest `true` (kein bedingter Enable/Disable wie bei den beiden
    App.tsx-Dialogen, da die Komponente ohnehin nur bei Bedarf gemountet
    wird)

Zustände: offen (Komponente gemountet) · geschlossen (unmounted). Escape —
  **einzige Stelle mit echtem Escape-Handling**: eigener `keydown`-Listener
  (`SeriesScopeDialog.tsx:25-34`) ruft bei `Escape` `onCancel()` auf — anders
  als Haupt-Modal und Bestätigungsdialog in `App.tsx`. disabled/hover/loading
  — nicht zutreffend auf Dialog-Ebene.

Verwendung: `src/components/SeriesScopeDialog.tsx`, gerendert in
`src/App.tsx:1351-1357` bei `seriesScope !== null`.

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-overlay`, `bg-surface`, `z-overlay`, `z-modal`, `z-toast` (letzteres für
toast.md) sind in `tailwind.config.js` (`theme.extend.colors` bzw.
`theme.extend.zIndex`) definiert und mappen auf `--color-overlay`,
`--color-surface`, `--z-overlay`, `--z-modal` in `src/tokens.css`. `z-40` ist
Tailwinds eingebaute Standard-Skalenstufe (nicht in `tailwind.config.js`
definiert, da sie zur Tailwind-Grundpalette gehört) — bestätigt als
niedrigerer Rohwert (40) gegenüber den Token-Werten (1200/1300).
`useModalFocusTrap` in `src/lib/useModalFocusTrap.ts` verifiziert (Fokus +
Tab-Falle, kein Escape-Handling in der Hook selbst).
