# Toast

Anatomie: Eine einzige Toast-Instanz in `src/App.tsx` (kein eigenes
Component, kein Toast-Stack) — `toast: string | null`-State,
`showToast(message)` setzt den Text und einen 2500ms-Timer, der ihn wieder
auf `null` setzt (`App.tsx:227-233`). Rendert nur, solange `toast` gesetzt
ist (`App.tsx:1402-1414`): `<div role="status" aria-live="polite">`.

Tokens:
  Fläche/Text: `bg-surface-inverse text-on-primary` — bewusst invertierte
    Fläche (dunkel im Hellmodus, s. Kommentar `tokens.css:62`: „Toast:
    invertierte Fläche"), unabhängig von der Nachrichtenart (Erfolg und
    Fehler nutzen dieselbe Optik, keine Farbcodierung nach Meldungstyp)
  Form: `rounded-full px-4 py-2 text-sm shadow-lg`
  z-Ebene: `z-toast` (`var(--z-toast)` = 1400 — höchste der vier
    UI-Ebenen-Tokens außer Tooltip, liegt über Modal `z-modal` = 1300)
  Position Desktop (`!mobile`): `fixed bottom-4 left-1/2 -translate-x-1/2`
  Position Mobil (`mobile`): `fixed bottom-20 left-1/2 -translate-x-1/2` —
    höher verankert als Desktop, sonst läge der Toast im selben
    Bildschirmstreifen wie die `BottomNav` (App.tsx:885) (Kommentar
    `App.tsx:1121-1123`). Der Abstand bleibt unabhängig davon bestehen, ob
    BottomNav `fixed` oder (seit dem #27-Review-Fix, s. button.md „FAB")
    ein normaler Flex-Bruder ist -- beide belegen denselben ca. 64-70px
    hohen Streifen am Viewport-Boden.
  focus: nicht zutreffend — der Toast ist nicht interaktiv (kein Button,
    kein Fokus-Ziel), `role="status"`/`aria-live="polite"` meldet ihn
    Screenreadern, ohne den Tastaturfokus zu verschieben

Zustände: sichtbar (`toast !== null`) · unsichtbar (`toast === null`,
  Timer abgelaufen oder Komponente unmounted, Timer-Cleanup
  `App.tsx:235-240`). Kein manueller Schließen-Button, keine
  Ein-/Ausblend-Animation (kein `transition`/`animate-*` an der Klasse),
  kein Hover/Focus/Disabled/Loading-Zustand — der Toast ist reine,
  nicht-interaktive Information mit fester Anzeigedauer.

Verwendung: `src/App.tsx:227-233` (`showToast`-Definition, inkl. Fix für
mehrfach überschriebene Timer, Finding 54), `src/App.tsx:1402-1414` (Markup),
aufgerufen u. a. bei „Eintrag gespeichert"/„Termin gespeichert" (Erfolg) und
`toUserMessage(e)`-Fehlermeldungen (Fehler) — beide Fälle identisch
gestylt, keine Erfolg/Fehler-Unterscheidung in der Optik.

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-surface-inverse`, `text-on-primary`, `z-toast` — in `tailwind.config.js`
(`theme.extend.colors` bzw. `theme.extend.zIndex`) definiert, mappen auf
`--color-surface-inverse` (`src/tokens.css:62`, Dark-Block `210`/`297`) und
`--z-toast` (`src/tokens.css:171`).
