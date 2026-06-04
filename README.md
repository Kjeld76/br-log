# BR-Log

Lokale Desktop-App zur **Zeiterfassung für Betriebsratsmitglieder**. Jedes
Mitglied erfasst seine BR-Zeiten tagesgenau (Stunden + Minuten). Zu jedem
Eintrag werden zwei Informationsebenen getrennt gehalten:

1. **Info für die Geschäftsleitung** – Angaben, die der Arbeitgeber erfahren darf.
2. **Vertrauliche Tätigkeitsbeschreibung** – die genaue Tätigkeit, die wegen des
   **BR-Geheimnisses** nicht an den Arbeitgeber gelangt.

Alle Daten liegen ausschließlich **lokal** in einer SQLite-Datei auf dem Gerät.
Es gibt **keinen Server**. Datenaustausch erfolgt nur durch bewussten Export
(CSV/JSON) oder Kopieren der Datenbankdatei.

## Funktionen

- Zeiteinträge mit Datum, Von/Bis **oder** direkter Dauer (Std:Min)
- Standard-Aufgaben als editierbare Schlagwörter (BR-Sitzung, Ausschuss,
  Fahrzeit, Schulung …), Mehrfachauswahl
- Trennung „Info für GL" vs. „Vertraulich" (BR-Geheimnis)
- Geplante Schicht (ja/nein) + Freitext zum Schichtausgleich
- Mehrere Widersprüche der Geschäftsleitung je Eintrag (Begründung + Name)
- Volltextsuche (FTS5) – vertrauliche Treffer werden in Listen nie im Klartext
  gezeigt, nur als „Treffer in vertraulichem Feld"
- Schlagwort-Filter als Chips, Datums-/Zeitraumfilter, Tages-/Monatssummen
- Kalender-Monatsansicht mit markierten Tagen und Tagessummen
- Export: GL-CSV (ohne Vertrauliches), Voll-CSV, JSON-Backup/Import (Merge)

## Datenspeicherort

Die Datenbank liegt unter Windows in:

```
%APPDATA%\de.betriebsrat.brzeiten\br_zeiten.db
```

Der genaue Pfad wird in der App unter **„Über / Daten"** angezeigt; dort öffnet
ein Klick den Ordner im Explorer (für manuelle Backups). Zum Sichern einfach die
Datei `br_zeiten.db` kopieren.

## Installation (für BR-Kolleginnen und -Kollegen)

1. Auf der **GitHub-Releases-Seite** den neuesten Release öffnen.
2. Die Datei `BR-Log_x.y.z_x64-setup.exe` (NSIS-Installer) herunterladen.
3. Doppelklick zum Installieren – **keine Administratorrechte nötig**
   (Installation ins Benutzerverzeichnis).

### Hinweis zum Windows-SmartScreen

Da der Installer (noch) **nicht signiert** ist, zeigt Windows beim ersten Start
ggf. eine SmartScreen-Warnung „Der Computer wurde durch Windows geschützt".
So lässt sich die App trotzdem starten:

1. Auf **„Weitere Informationen"** klicken.
2. Anschließend auf **„Trotzdem ausführen"** klicken.

Dies ist nur einmalig erforderlich. (Optional kann der Installer künftig mit
einem Code-Signing-Zertifikat signiert werden, dann entfällt die Warnung –
siehe Abschnitt *Entwicklung → Code-Signing*.)

## Entwicklung

Voraussetzungen: Node.js 20+, Rust (stable), und unter Windows die
Visual-Studio-Build-Tools sowie WebView2.

```bash
npm install
npm run tauri dev      # App im Entwicklungsmodus starten
npm run tauri build    # NSIS-Installer bauen (Ausgabe unter src-tauri/target/release/bundle)
```

### Branches

- `main` – stabil/Releases
- `develop` – aktive Entwicklung
- Feature-Branches nach Bedarf (von `develop`)

### Release

Ein Git-Tag `vX.Y.Z` löst den GitHub-Actions-Workflow aus, der auf
`windows-latest` den NSIS-Installer baut und als Release-Asset hochlädt:

```bash
git tag v1.0.0
git push --tags
```

### Code-Signing (optional, derzeit deaktiviert)

Der Build ist bewusst **unsigniert**. Für eine Signatur künftig:

1. Code-Signing-Zertifikat beschaffen.
2. In `src-tauri/tauri.conf.json` unter `bundle.windows` die
   `certificateThumbprint`/`digestAlgorithm`/`timestampUrl` setzen.
3. Neu bauen – die SmartScreen-Warnung entfällt nach Reputationsaufbau.

## Lizenz

Proprietär – alle Rechte vorbehalten. Siehe [LICENSE](LICENSE).
© 2026 Mario König.
