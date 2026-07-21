# SettingsPanel (Einstellungen-Modal, Master-Detail)

Anatomie: `src/components/SettingsPanel.tsx`, gerendert im Haupt-Modal-Überbau
als `modal.type === "settings"` (`App.tsx`, s. modal.md). Bündelt vier
Abschnitte -- Darstellung, Kalender & Erinnerungen, Sicherheit, Datenbank --,
die jeweils ein bestehendes Unter-Panel unverändert einbetten
(`ThemeToggle`/`ReminderSettings`/`SecurityPanel`/`DbInfoPanel`). Neu seit
Design-Handoff #28 („Di", Desktop-Fassung): zwei alternative Layouts für
DIESELBEN vier Abschnitte, umgeschaltet über eine **Container Query** (nicht
Viewport-Breakpoint, nicht das `mobile`-Flag):

- **Schmal** (Panel-Breite < 640px -- Android, aber auch ein schmales
  Desktop-Fenster): einspaltige Stapelung aller vier Abschnitte
  nacheinander, wie vor #28. Keine Abschnittsliste sichtbar.
- **Breit** (Panel-Breite ≥ 640px): Master-Detail -- Abschnittsliste links
  (12rem breit), Detailbereich (der aktive Abschnitt) rechts.

## Mechanismus (Container Query statt Viewport/`mobile`-Flag)

`src/styles.css:158-181`:
  `.settings-shell` (`SettingsPanel.tsx`, äußerster Wrapper): `container-type:
    inline-size; container-name: settings;` -- macht die tatsächliche
    Breite DES PANELS (nicht des Viewports) zur Bedingung. Grund (CLAUDE.md,
    „Container Queries für neue platzabhängige Komponenten"): ein schmales
    Desktop-Fenster soll bei der Stapelung bleiben statt zwei gequetschte
    Spalten zu bekommen -- das leistet ein Viewport-Breakpoint nicht, weil er
    nur die Fenstergröße kennt, nicht die tatsächlich verfügbare Panel-Breite.
  `.settings-nav-list`: `display: none` per Default, `display: block` erst
    innerhalb `@container settings (min-width: 640px)`. 640px = derselbe
    Zahlenwert wie Tailwinds `sm:`-Breakpoint, hier als Container- statt
    Viewport-Bedingung übernommen (Konsistenz zum übrigen „genug Platz"-Maß
    der Views, s. StatsView `sm:grid-cols-4`).
  `.settings-layout` wird erst in der Container Query zum 2-Spalten-Grid
    (`grid-template-columns: 12rem 1fr; gap: 1.5rem`) -- im schmalen Fall
    bleibt es ein normaler Block-Container (Abschnittsliste ohnehin
    `display: none`, kein Grid nötig).
  `.settings-section[data-active]`: **immer** gemountet (alle vier
    Unter-Panels laden/rendern genau einmal, unabhängig vom Layout) --
    nur die CSS-Sichtbarkeit wechselt. Schmal: kein Override, alle vier
    `display: block` (Default für `<section>`). Breit: `display: none` per
    Default, `display: block` nur für `[data-active="true"]`. Damit gibt es
    **kein doppeltes Mounten** der stateful Unter-Panels (kein doppelter
    `getDbPathInfo()`/Autostart-Abfrage-Aufruf für zwei Layout-Varianten) --
    einziger Grund, warum die Umschaltung nicht einfach beide Layout-Bäume
    parallel rendert und per CSS blendet.
  Kein Tailwind-Container-Query-Plugin nötig/installiert (Tailwind 3.4 hat
    `@container` erst über `@tailwindcss/container-queries`) -- reines CSS in
    `styles.css`, wie die übrigen Bestandsklassen dort (`.brand-logo-wrap`,
    `.appt-chip-*`, s. chip.md).

## Abschnittsliste (`SettingsPanel.tsx`, `settings-nav-list`)

Tokens:
  aktiv: `bg-selected-surface font-medium text-info-ink` -- identisch zum
    aktiven Sidebar-NAV-Eintrag (`Sidebar.tsx`, „das aktive NAV-Item nimmt die
    Akzentfarbe auch im Icon an", Design-Handoff #28 „Da")
  inaktiv: `text-secondary-ink hover:bg-surface-2` -- identisch zu Sidebar
  Form: `block w-full rounded-lg px-3 py-2 text-left text-sm transition`
  a11y: native `<button type="button">` (Tastatur-Enter/Leertaste
    funktionieren ohne eigenen `onKeyDown`), `aria-current="page"` am
    aktiven Eintrag -- selbes Muster/selber Wert wie `BottomNav.tsx:51`
  focus: kein lokales `focus-visible:` -- globaler Ring aus `styles.css:22-25`
    (native `<button>`, wie Sidebar/BottomNav)

Zustände: aktiv/inaktiv, hover (nur inaktiv), focus-visible (global).
  disabled/loading -- nicht vorhanden (Navigation ist immer verfügbar).
  In der schmalen Stapel-Ansicht ohne sichtbare Wirkung (per CSS
  ausgeblendet) -- `active`-State existiert trotzdem unverändert, steuert
  dort nur nichts.

Verwendung: einzige Fundstelle `src/components/SettingsPanel.tsx`.

## Verifikation der Utilities (Grep-Gegenprobe)

`bg-selected-surface`, `text-info-ink`, `text-secondary-ink`, `bg-surface-2`
in `tailwind.config.js` (`theme.extend.colors`) definiert, mappen auf
`--color-selected-surface`/`--color-info-ink`/... in `src/tokens.css` (beide
Modi gepflegt). `.settings-shell`/`.settings-nav-list`/`.settings-layout`/
`.settings-section` als reine CSS-Klassen in `src/styles.css:158-181`
verifiziert (keine Tailwind-Utility, da Tailwind 3.4 ohne
Container-Query-Plugin `@container` nicht generieren kann).
