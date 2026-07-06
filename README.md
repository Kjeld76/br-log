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

- Zeiteinträge mit Datum, Von/Bis **oder** direkter Dauer (Std:Min/Minuten),
  inkl. Schichten über Mitternacht und Uhrzeit-/Dauer-Schnellwahl
- Standard-Aufgaben als editierbare Schlagwörter (BR-Sitzung, Ausschuss,
  Fahrzeit, Schulung …), Mehrfachauswahl; archivierte, einem Eintrag bereits
  zugewiesene Schlagwörter bleiben sichtbar und entfernbar
- Trennung „Info für GL" vs. „Vertraulich" (BR-Geheimnis)
- Geplante Schicht (ja/nein) + Freitext zum Schichtausgleich
- Mehrere Widersprüche der Geschäftsleitung je Eintrag (Begründung + Name)
- Wiederverwendung: Eintrag duplizieren (heutiges Datum, frische ID) sowie
  „wie beim letzten Eintrag" für Schlagwörter/GL-Info übernehmen
- Nicht-blockierende Überlappungswarnung beim Speichern, wenn sich ein
  Zeitraum mit einem bestehenden Eintrag überschneidet
- Tastaturbedienung im Erfassungsformular: Strg/Cmd+Enter speichert, Escape
  bricht ab (mit Rückfrage bei ungespeicherten Änderungen), Autofokus
- Ungespeicherte Eingaben im Erfassen-Formular überstehen App-Neustarts
  (lokaler Zwischenstand) und lösen beim Verwerfen eine Rückfrage aus
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

Unter Linux liegt sie in:

```
~/.config/de.betriebsrat.brzeiten/br_zeiten.db
```

Der genaue Pfad wird in der App unter **„Über / Daten"** angezeigt; dort öffnet
ein Klick den Ordner im Dateimanager (für manuelle Backups). Die Datenbank ist mit
SQLCipher verschlüsselt; der Schlüssel liegt gekapselt in einer zweiten Datei
`keyfile.json` **im selben Ordner**. Für ein manuelles Backup deshalb **immer
beide Dateien zusammen** sichern (`br_zeiten.db` **und** `keyfile.json`) – eine
Kopie nur der Datenbank ist ohne die Schlüsseldatei nicht entschlüsselbar, auch
nicht mit dem Wiederherstellungs-Code (der entkapselt nur die in der
`keyfile.json` abgelegten Schlüsseldaten). Schlüsselunabhängig ist der
**JSON-Export** (App → Daten → „Sicherung & Übertragung" → JSON-Backup
speichern) – er funktioniert ohne `keyfile.json` und ohne Passwort und ist
damit der robustere Weg für Geräteübertragungen und Zweitsicherungen.

Zusätzlich legt die App bei jedem Entsperren automatisch ein konsistentes
Backup (Datenbank + `keyfile.json` zusammen) im Unterordner `backups/` neben
der Hauptdatenbank an, rotierend über die letzten 5 Stände. Zum
Wiederherstellen bei geschlossener App die gewünschten Dateien aus `backups/`
zurück auf `br_zeiten.db` bzw. `keyfile.json` kopieren. Unter „Über / Daten"
lässt sich zusätzlich jederzeit manuell ein Backup anstoßen.

Läuft die App **portabel vom USB-Stick**, liegt die Datenbank stattdessen neben
der EXE in `BR-Log-Data\br_zeiten.db` (siehe Abschnitt *Portable Version*).

### Android

Auf Android liegen Datenbank, `keyfile.json` und der automatische
`backups/`-Ordner in der **App-eigenen Sandbox** – ohne Root-Zugriff für
Nutzer weder einsehbar noch manuell kopierbar. **Beim Deinstallieren der App
werden alle drei unwiederbringlich gelöscht.** Der einzige Rettungsweg ist
der **JSON-Export** (App → Daten → „Sicherung & Übertragung" →
JSON-Backup speichern): schlüsselunabhängig, funktioniert ohne `keyfile.json`
und ohne Passwort – regelmäßig exportieren und außerhalb des Geräts sichern
(z. B. Cloud-Speicher, PC). Sideload-Hinweise für Android siehe Abschnitt
*Installation (Android)* unten.

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

## Installation (Linux)

BR-Log steht für Linux als **.deb-Paket** (Debian/Ubuntu und Ableitungen) und
als distributionsunabhängiges **AppImage** zur Verfügung – siehe die
**GitHub-Releases-Seite**.

### .deb-Paket (Debian/Ubuntu)

```bash
sudo apt install ./BR-Log_x.y.z_amd64.deb
```

`apt install ./Datei.deb` löst dabei automatisch fehlende Abhängigkeiten mit
auf – anders als das reine `dpkg -i`, das dafür einen zusätzlichen
`apt --fix-broken install`-Schritt bräuchte.

### AppImage (distributionsunabhängig)

1. `BR-Log_x.y.z_amd64.AppImage` von der Releases-Seite herunterladen.
2. Ausführbar machen und starten:

```bash
chmod +x BR-Log_x.y.z_amd64.AppImage
./BR-Log_x.y.z_amd64.AppImage
```

Unter **Ubuntu 22.04 und neuer** fehlt `libfuse2` standardmäßig (AppImages
brauchen FUSE 2 zum Einhängen); ohne das Paket startet die AppImage nicht:

```bash
sudo apt install libfuse2
```

Der Datenspeicherort unter Linux ist in beiden Fällen identisch, siehe
Abschnitt *Datenspeicherort*.

## Installation (Android)

BR-Log steht für Android als **APK zum Sideload** zur Verfügung – siehe die
**GitHub-Releases-Seite**. Kein Play-Store-Eintrag, die App ist nur für den
internen BR-Kreis gedacht.

1. Auf der **GitHub-Releases-Seite** den neuesten Release öffnen und die
   Datei `BR-Log_x.y.z_android-arm64.apk` herunterladen (arm64 deckt alle
   gängigen Android-Smartphones der letzten Jahre ab).
2. Beim ersten Installationsversuch fragt Android automatisch nach der
   Erlaubnis **„Unbekannte Apps installieren"** für die App, mit der die
   APK geöffnet wurde (Browser oder Dateimanager) – zustimmen. Alternativ
   vorab manuell unter **Einstellungen → Apps → [Browser/Dateimanager] →
   Unbekannte Apps installieren**.
3. Die heruntergeladene APK antippen und installieren.

### Hinweis zu Google Play Protect

Da die APK nicht über den Play Store verteilt wird, warnt **Play Protect**
beim Installieren möglicherweise vor einer App aus „unbekannter Quelle".
Das ist bei jeder Sideload-Installation außerhalb des Play Store normal und
kein Hinweis auf ein Sicherheitsproblem – über **„Trotzdem installieren"**
fortfahren.

### Updates

Ein Update läuft genauso: die neue APK-Version von der Releases-Seite laden
und **über die bestehende Installation drüberinstallieren**, nicht vorher
deinstallieren. Das funktioniert nur, weil alle BR-Log-Versionen mit
**demselben Signing-Key** signiert sind – Android verweigert die
Drüberinstallation, sobald sich die Signatur unterscheidet. Die App-Daten
(Datenbank, `keyfile.json`, `backups/`) bleiben dabei erhalten.

> **⚠️ Vor einer Deinstallation:** Anders als bei Windows/Linux liegen die
> Daten auf Android in der App-Sandbox und werden bei einer Deinstallation
> **unwiederbringlich gelöscht** (siehe Abschnitt *Datenspeicherort →
> Android* oben). Vorher immer den **JSON-Export** sichern.

## Portable Version (USB-Stick)

> **Hinweis:** Der portable USB-Modus (Daten neben der Programmdatei, per
> `portable.txt`-Marker erkannt) ist aktuell **Windows-only**. Unter Linux
> gibt es dafür regulär die .deb-Installation oder das AppImage (siehe
> Abschnitt *Installation (Linux)*) – beide legen die Datenbank unter
> `~/.config/de.betriebsrat.brzeiten/` ab, nicht neben der Programmdatei.

Neben dem Installer gibt es eine **portable Version**, die ohne Installation
direkt vom USB-Stick läuft – die Daten reisen mit:

1. Auf der **Releases-Seite** die Datei `BR-Log-portable-vX.Y.Z.zip` herunterladen.
2. Den Inhalt **auf den USB-Stick** entpacken (`BR-Log.exe`, `portable.txt`,
   Ordner `BR-Log-Data`).
3. `BR-Log.exe` direkt vom Stick starten.

Die Datenbank liegt dann **neben der EXE** in `BR-Log-Data\br_zeiten.db` und
wandert mit dem Stick mit; die zugehörige `keyfile.json` liegt im selben
Ordner `BR-Log-Data` und wandert automatisch mit. In der App zeigt „Über /
Daten" das Abzeichen **„Portabel (USB)"** und den tatsächlichen Pfad.

> **⚠️ Vertraulichkeit (BR-Geheimnis):** Den Ordner **nicht** in einen
> Cloud-synchronisierten Ordner (OneDrive, Dropbox …) entpacken – sonst würde die
> vertrauliche Datenbank in die Cloud hochgeladen. Nur auf einen echten USB-Stick
> oder lokalen Datenträger.

### Wie der portable Modus erkannt wird

Der portable Modus greift nur, wenn neben der EXE eine Datei `portable.txt` liegt,
die eine Zeile **`BR-Log-Portable`** enthält (in der mitgelieferten Datei steht
sie in der ersten Zeile). Eine leere oder fremde `portable.txt` aktiviert den
Modus **nicht**. Ist der
Stick schreibgeschützt und noch keine portable Datenbank vorhanden, fällt die App
auf den Installations-Pfad zurück; vorhandene Stick-Daten werden nie überschrieben.

### Voraussetzung WebView2

Die schlanke portable Version nutzt die **Microsoft Edge WebView2 Runtime** des
Rechners (auf Windows 11 vorhanden). Startet die App nicht, die WebView2
„Evergreen"-Runtime von Microsoft installieren. Der oben beschriebene
Windows-SmartScreen-Hinweis gilt für die portable EXE genauso. Die portable
Version ist nur wenige MB groß – ein einfacher USB-Stick genügt.

## Entwicklung

Voraussetzungen: Node.js 20+, Rust (stable), und unter Windows die
Visual-Studio-Build-Tools sowie WebView2. Für den verschlüsselten DB-Build
(SQLCipher via gebundeltem OpenSSL) zusätzlich ein **natives Perl**
(z. B. Strawberry Perl – das mit Git gelieferte msys-Perl funktioniert **nicht**).
NASM ist optional (ohne NASM baut OpenSSL im langsameren `no-asm`-Modus).

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
