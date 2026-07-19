# Roadmap

Arbeitsweise: **Konkrete, umsetzbare Punkte** bekommen ein Issue mit dem Label
[`enhancement`](https://github.com/Kjeld76/br-log/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
(am besten über das Formular „Feature-Vorschlag"). **Vage Ideen** werden erst
hier unter „Angedacht" gesammelt und wandern in ein Issue, sobald sie greifbar
sind. Diese Datei ist der grobe Kompass, die Issues sind die Wahrheit im Detail.

## Geplant / Als Nächstes

Die Gruppierung folgt den
[GitHub-Milestones](https://github.com/Kjeld76/br-log/milestones) — jede
Stufe ist ein thematisch rundes Release, die Reihenfolge beachtet die
Abhängigkeiten (z. B. Datenlebenszyklus erst nach den Anhängen).

### v1.7.0 — Alltag & Sichtschutz

- Druckfertiger PDF-Stundennachweis für die GL — [#16](https://github.com/Kjeld76/br-log/issues/16)
- Auto-Sperre, Sofortsperre und Sichtschutz (Blur) — [#17](https://github.com/Kjeld76/br-log/issues/17)
- Technische Härtung: seriesEndDateFor-Randfälle — [#10](https://github.com/Kjeld76/br-log/issues/10)

### v1.8.0 — § 37-Konten

- Freizeitausgleich-Konto nach § 37 Abs. 3 BetrVG — [#12](https://github.com/Kjeld76/br-log/issues/12)
- Amtszeit-Verwaltung + Schulungskonto (§ 37 Abs. 6/7 BetrVG) — [#13](https://github.com/Kjeld76/br-log/issues/13)

### v1.9.0 — Fristen & Gesetze

- Fristen-Tracker mit BetrVG-Vorlagen — [#14](https://github.com/Kjeld76/br-log/issues/14)
- Offline-Gesetzestexte mit In-App-Suche — [#19](https://github.com/Kjeld76/br-log/issues/19)

### v1.10.0 — Beweisakte & Datenlebenszyklus

- Verschlüsselte Dateianhänge — [#15](https://github.com/Kjeld76/br-log/issues/15)
- Datenlebenszyklus-Modul (§ 79a BetrVG / DSGVO) — [#18](https://github.com/Kjeld76/br-log/issues/18)

## Größere Vorhaben / Zurückgestellt

- **v2.0.0 (Epic, Major-Update):** Gremienmodell — Ausweitung auf JAV und SBV,
  voraussichtlich inkl. Namens-/Branding-Änderung — [#20](https://github.com/Kjeld76/br-log/issues/20)
  (definiert bereits jetzt Design-Vorgaben für #13 und #14)
- **Backlog (bewusst ohne Milestone):** Auslagen-Log nach § 40 BetrVG — [#21](https://github.com/Kjeld76/br-log/issues/21)
  (ausdrücklich zurückgestellt; Voraussetzung: Anhänge #15)

## Angedacht (unsortiert)

*(noch leer — vage Ideen landen zuerst hier)*

## Erledigt

- **v1.6.0** — Kalender-Feinschliff: beendete Serien raus aus dem Lade-Hot-Path,
  testbare Erinnerungs-Orchestrierung, vereinheitlichter Import-Fluss
- **v1.5.x** — Terminkalender mit Serienterminen (RRULE), Erinnerungen
  (Desktop + Android), ICS-Import/-Export, Termin-Suche; semantisches
  Design-Token-System (Light/Dark)
