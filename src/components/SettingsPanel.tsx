import { useState } from "react";
import DbInfoPanel from "./DbInfoPanel";
import ReminderSettings from "./ReminderSettings";
import SecurityPanel from "./SecurityPanel";
import ThemeToggle from "./ThemeToggle";
import type { AndroidLockDelaySec } from "../lib/lockDelay";

interface Props {
  onLockNow: () => void;
  onAutoLockChanged: (minutes: number) => void;
  // Issue #17, Task 7: reines Durchreichen an SecurityPanel (Android-only
  // Einstellung "Sperren beim Verlassen der App"), analog onAutoLockChanged.
  onAndroidLockDelayChanged: (sec: AndroidLockDelaySec) => void;
  // Konvention (siehe App.tsx): isAndroid() wird zentral EINMAL in App.tsx
  // ermittelt und als Prop durchgereicht -- hier nur zum Durchreichen an
  // DbInfoPanel und SecurityPanel (Fingerabdruck-Abschnitt) gebraucht.
  mobile: boolean;
}

const heading = "mb-2 text-sm font-semibold text-primary-ink";

type SectionId = "darstellung" | "erinnerungen" | "sicherheit" | "datenbank";

const SECTION_ORDER: SectionId[] = [
  "darstellung",
  "erinnerungen",
  "sicherheit",
  "datenbank",
];
const SECTION_LABELS: Record<SectionId, string> = {
  darstellung: "Darstellung",
  erinnerungen: "Kalender & Erinnerungen",
  sicherheit: "Sicherheit",
  datenbank: "Datenbank",
};

// Bündelt die vier App-weiten Einstellungsblöcke (Darstellung, Kalender &
// Erinnerungen, Sicherheit, Datenbank), die bisher Teil der Daten-Ansicht
// waren (siehe DataView) -- jetzt im Einstellungen-Modal, erreichbar über das
// neue AppMenu. Der "Über"-Teil, der zuvor am Ende von DbInfoPanel steckte,
// ist ausgezogen ins eigenständige AboutPanel (eigener Menüpunkt
// "Über BR-Log").
//
// Layout (Design-Handoff #28, "Di" -- Desktop-Fassung): Auf schmalen Panels
// (Android, aber auch ein schmales Desktop-Fenster) bleibt die bestehende
// vertikale Stapelung aller vier Abschnitte -- vollständig bedienbar, kein
// Abschnitt versteckt. Ab ausreichender PANEL-Breite (nicht Viewport-Breite!)
// übernimmt eine Master-Detail-Ansicht: Abschnittsliste links, Detailbereich
// rechts. Die Umschaltung läuft über eine Container Query
// (`.settings-shell`/`.settings-nav-list`/`.settings-section`, s.
// styles.css) statt eines Viewport-Breakpoints oder des `mobile`-Flags -- ein
// schmales Desktop-Fenster bekommt so bewusst weiterhin die einspaltige
// Stapelung statt zweier gequetschter Spalten, ganz unabhängig davon, ob es
// sich um Android oder Desktop handelt (CLAUDE.md: "Container Queries für
// neue platzabhängige Komponenten").
//
// `active` steuert dabei NUR, welcher Abschnitt in der Master-Detail-Ansicht
// sichtbar ist -- in der Stapel-Ansicht sind ohnehin alle vier gleichzeitig
// sichtbar (die Container Query blendet dort nichts aus, s. styles.css). Alle
// vier Unter-Panels werden dadurch immer genau einmal gemountet (kein
// doppeltes Laden von Datenbankpfad/Autostart-Status o. Ä. für zwei
// Layout-Varianten) -- nur ihre CSS-Sichtbarkeit ändert sich mit der
// Panel-Breite.
export default function SettingsPanel({
  onLockNow,
  onAutoLockChanged,
  onAndroidLockDelayChanged,
  mobile,
}: Props) {
  const [active, setActive] = useState<SectionId>(SECTION_ORDER[0]);

  const section = (id: SectionId, content: React.ReactNode) => (
    <section className="settings-section" data-active={active === id}>
      <h3 className={heading}>{SECTION_LABELS[id]}</h3>
      {content}
    </section>
  );

  return (
    <div className="settings-shell">
      <div className="settings-layout">
        {/* Nur in der Master-Detail-Ansicht sichtbar (Container Query in
            styles.css) -- in der Stapel-Ansicht ohne Wirkung, weil dort per
            CSS ausgeblendet. Tastaturbedienbar (native <button>), aktiver
            Abschnitt über aria-current (Muster wie Sidebar.tsx/BottomNav.tsx). */}
        <nav
          className="settings-nav-list mb-4 space-y-1"
          aria-label="Einstellungsabschnitte"
        >
          {SECTION_ORDER.map((id) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                aria-current={isActive ? "page" : undefined}
                className={
                  "block w-full rounded-lg px-3 py-2 text-left text-sm transition " +
                  (isActive
                    ? "bg-selected-surface font-medium text-info-ink"
                    : "text-secondary-ink hover:bg-surface-2")
                }
              >
                {SECTION_LABELS[id]}
              </button>
            );
          })}
        </nav>

        <div className="settings-detail flex flex-col gap-8">
          {section(
            "darstellung",
            <div className="rounded border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-secondary-ink">
                  Erscheinungsbild
                </span>
                <ThemeToggle />
              </div>
            </div>
          )}

          {section("erinnerungen", <ReminderSettings mobile={mobile} />)}

          {section(
            "sicherheit",
            <SecurityPanel
              onLockNow={onLockNow}
              onAutoLockChanged={onAutoLockChanged}
              onAndroidLockDelayChanged={onAndroidLockDelayChanged}
              mobile={mobile}
            />
          )}

          {section("datenbank", <DbInfoPanel mobile={mobile} />)}
        </div>
      </div>
    </div>
  );
}
