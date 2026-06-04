# Zukunftsplanung: Portable USB-Version & Geschützter Login

Dieses Dokument hält zwei geplante Erweiterungen von BR-Log fest. Es ist eine
Roadmap – noch keine Umsetzung. BR-Log speichert sensible Daten (BR-Geheimnis)
lokal in einer SQLite-Datei; beide Features zielen darauf, diese Daten auch
mobil (USB-Stick) und vor unbefugtem Zugriff zu schützen.

> **Kernspannung vorweg:** „Portabel auf USB" + „sensible Daten" + „schnell" passen
> nicht vollständig zusammen. Ein reiner UI-Passwort-Gate ist am schnellsten,
> schützt aber einen **verlorenen USB-Stick nicht** (die `.db` bliebe im Klartext
> lesbar). Echter Schutz im USB-Fall erfordert **Verschlüsselung der Datenbank**.
> Daher der phasierte Weg unten.

---

## Feature 1 – Portable Version (USB-Stick)

**Ziel:** `BR-Log.exe` direkt vom Stick starten; die SQLite-Datei liegt **neben der
EXE auf dem Stick**, sodass die Daten mitreisen. Keine Installation.

**Bausteine:**

1. **Standalone-EXE:** Tauri erzeugt bereits eine selbstständige `br-log.exe`
   (Frontend eingebettet). Für portabel die rohe EXE verteilen (kein NSIS-Installer).

2. **Portabler Datenpfad (Kernänderung):**
   - Aktuell: DB unter `%APPDATA%\de.betriebsrat.brzeiten\br_zeiten.db`.
   - Portabel: `<EXE-Ordner>\BR-Log-Data\br_zeiten.db`.
   - **Erkennung:** Marker-Datei `portable.txt` neben der EXE → Portable-Modus
     (sofern der Ordner beschreibbar ist); sonst Installations-Modus (`%APPDATA%`).
   - **Umsetzung in `src-tauri/src/lib.rs` (`run()`):** Vor dem Builder den
     Portable-Modus erkennen, den **absoluten DB-Pfad + Connection-String** berechnen
     und die Migrationen unter **genau diesem Connection-String** registrieren.
     (`tauri-plugin-sql` schlüsselt Migrationen nach Connection-String – aktuell
     `add_migrations("sqlite:br_zeiten.db", …)`.) Den String per neuem Command
     `db_connection_string()` ans Frontend geben.
   - **`src/db/client.ts`:** statt fixem `DB_URL = "sqlite:br_zeiten.db"` den String
     per `invoke("db_connection_string")` holen und `Database.load(url)` damit aufrufen
     → Migration-Key == Load-Key bleibt konsistent.
   - **Zu verifizieren:** Ob `tauri-plugin-sql` einen **absoluten Pfad** im
     `sqlite:`-URL akzeptiert. Falls nicht → DB-Layer auf eine eigene rusqlite-basierte
     Command-Schicht umstellen (wäre ohnehin für Feature 2 nötig – siehe Synergie).
   - `DbInfoPanel` zeigt den portablen Pfad; „Im Explorer öffnen" funktioniert mit
     absolutem Pfad.

3. **WebView2-Runtime:** Die App braucht die Edge-WebView2-Runtime (auf Win11 / aktuellem
   Win10 vorhanden).
   - **Variante „schlank":** Voraussetzung dokumentieren (meist erfüllt).
   - **Variante „voll portabel":** WebView2 **Fixed Version Runtime** (~120–180 MB)
     mitliefern; `tauri.conf.json` →
     `bundle.windows.webviewInstallMode = { type: "fixedRuntime", path: "./webview2/" }`.
     Läuft dann auf jedem PC ohne Internet/Install – aber großes Artefakt.

4. **Verteilung:** ZIP mit `br-log.exe` + `portable.txt` (+ optional WebView2-Ordner +
   leerer `BR-Log-Data\`). Nutzer entpackt auf den Stick. CI-Schritt in
   `.github/workflows/release.yml` ergänzen, der das Portable-ZIP als Release-Asset baut.

5. **Sicherheitskopplung:** Ein verlorener Stick mit Klartext-DB = Datenpanne →
   **Feature 2 (Verschlüsselung) ist für die portable Variante faktisch Pflicht.**

**Berührte Dateien (später):** `src-tauri/src/lib.rs`, `src/db/client.ts`,
`src-tauri/tauri.conf.json`, `.github/workflows/release.yml`, `README.md`.

**Aufwand (grob):** Portable-Modus 0,5–1 Tag; + Fixed-WebView2-Bündelung 0,5 Tag.

---

## Feature 2 – Geschützter Login

### Passwort vs. Passkey – Empfehlung: Passwort

- **Passkey (WebAuthn/FIDO2):** Ein **Plattform-Passkey** (Windows Hello) ist an einen
  bestimmten PC gebunden → reist **nicht** mit dem Stick → widerspricht der
  Portabilität. Ein **Roaming-Passkey** (FIDO2-Stick) reist zwar, braucht aber extra
  Hardware. Zudem ist WebAuthn in einem Tauri-Webview umständlich (eigener Origin/RP-ID,
  Secure-Context). → **Schlechte Passung für „portabel/jeder PC".**
- **Passwort:** reist mit den Daten, funktioniert auf jedem PC, keine Extra-Hardware,
  am einfachsten. → **Empfohlen.** (Optional später: Windows Hello als Komfort-Unlock
  nur in der installierten Variante.)

### Login-Stärke – die entscheidende Wahl

- **(A) UI-Passwort-Gate (am schnellsten):** Beim Start Passwort abfragen, gegen einen
  gespeicherten **Argon2id-Hash** prüfen, dann App rendern. Die `.db` bleibt
  **unverschlüsselt** → schützt **keinen verlorenen Stick**. Schnell, aber für das
  USB-Szenario unzureichend.
- **(B) Verschlüsselung at-rest (richtig, empfohlen):** Schlüssel aus dem Passwort
  ableiten (Argon2id) und die **gesamte DB mit SQLCipher verschlüsseln**. Ohne Passwort
  ist die `.db` kryptografisch unlesbar → schützt den verlorenen Stick. Mehr Aufwand:
  `tauri-plugin-sql` (sqlx) kann **kein** SQLCipher → DB-Layer-Umbau auf **rusqlite mit
  Feature `bundled-sqlcipher`** und `PRAGMA key`.

### Empfohlener phasierter Plan

- **Phase 1 (schnell):** Passwort-Gate – Erst-Einrichtung („Passwort setzen"),
  Unlock-Screen vor der App, Passwort ändern. *Klar dokumentiert: verschlüsselt die
  Datei noch nicht.*
- **Phase 2 (richtig, vor breiter USB-Verteilung):** SQLCipher-Verschlüsselung mit
  passwortabgeleitetem Schlüssel. Dasselbe Passwort **entsperrt** (Verifier) **und**
  **entschlüsselt** (KDF) – in Phase 2 ist die Verschlüsselung selbst der Verifier
  (kein separater Hash nötig). Einmalige Migration der bestehenden Klartext-DB →
  verschlüsselt.

### Schlüssel-/Secret-Handling

- Passwort wird nie gespeichert; nur Argon2id-Hash (Phase 1) bzw. „falscher Schlüssel →
  DB öffnet nicht" (Phase 2).
- **Brute-Force-Schutz:** ansteigende Verzögerung nach Fehlversuchen.
- **Recovery (wichtig):** Kein Passwort = keine Daten (by design). Daher
  **Recovery-Code / regelmäßiger JSON-Export** als sichere Reserve empfehlen und
  deutlich kommunizieren.
- KDF: Argon2id mit vernünftigen Memory-/Time-Kosten.

### UX

- Erststart: „Passwort festlegen". Folgestarts: Unlock-Screen **vor** der App (Gate in
  `src/App.tsx`). Optional Auto-Lock bei Inaktivität. In „Über / Daten": Passwort ändern
  / (Phase 2) neu verschlüsseln.

**Berührte Dateien (später):**

- Phase 1: `src/views/LockScreen.tsx` (neu), `src/lib/auth.ts` (neu), Gate in
  `src/App.tsx`, Rust-Command für Argon2 (Crate `argon2`), Hash neben der DB.
- Phase 2: DB-Layer in `src-tauri` auf **rusqlite + `bundled-sqlcipher`** umstellen
  (ersetzt `tauri-plugin-sql` für die DB-Zugriffe), Key-Derivation, `PRAGMA key`,
  Einmal-Re-Encrypt der bestehenden Daten.

**Crates:** `argon2` (KDF/Hash); Phase 2 `rusqlite` mit `bundled-sqlcipher`.

**Aufwand (grob):** Phase 1 ~1 Tag; Phase 2 ~2–4 Tage (DB-Layer-Umbau ist der Hauptteil).

---

## Synergie & empfohlene Reihenfolge

- **Portabel + sensibel ⇒ Verschlüsselung praktisch zwingend.** Wird die portable
  USB-Variante breit verteilt, sollte **mindestens Phase 2** dabei sein (oder Nutzer
  deutlich warnen).
- Der **DB-Layer-Umbau auf rusqlite** löst gleichzeitig (a) den absoluten Pfad für den
  Portable-Modus und (b) die SQLCipher-Verschlüsselung. → **Beide Features gemeinsam**
  auf Basis eines rusqlite-DB-Layers umsetzen ist effizienter als getrennt.
- **Vorgeschlagene Reihenfolge:**
  1. DB-Layer auf rusqlite (ermöglicht portabel + Krypto)
  2. Portable-Modus + Datenpfad
  3. Login Phase 1 (Gate)
  4. SQLCipher (Phase 2)
  5. CI-Portable-ZIP + Doku

---

## Verifikation (für die spätere Umsetzung)

- **Portable:** EXE + `portable.txt` auf einen (USB-)Ordner kopieren → starten → prüfen,
  dass `BR-Log-Data\br_zeiten.db` **neben der EXE** entsteht, Migration läuft, Einträge
  persistieren; auf zweitem PC vom selben Ordner starten → Daten vorhanden.
- **Login Phase 1:** Erststart fragt Passwort; falsches Passwort → kein Zugang; richtiges
  → App; Neustart verlangt erneut.
- **Login Phase 2:** Nach Aktivierung ist die `.db` mit externem SQLite-Tool **nicht**
  ohne Schlüssel lesbar; mit korrektem Passwort öffnet die App die Daten.
