import { defineConfig } from "vitest/config";

// Zeitzone der Testläufe FESTNAGELN, bevor irgendein Date entsteht: Die App
// rechnet durchgängig in lokaler Wandzeit (Termine, Serien-Expansion über
// DST-Grenzen, Erinnerungs-Fälligkeiten, UTC-UNTIL aus ICS-Importen). Ohne
// feste Zone hängt das Ergebnis solcher Tests an der Zone der ausführenden
// Maschine -- Entwicklungsrechner laufen hier in Europe/Berlin, CI-Runner in
// UTC. Genau daran ist der Release-Build von v1.7.0 gescheitert
// (seriesEndDateFor: lokales UNTIL-Datum ist in Berlin der Folgetag, in UTC
// nicht). Europe/Berlin ist die Zone der Zielnutzer und damit die
// aussagekräftige Annahme.
process.env.TZ = "Europe/Berlin";

// Eigenständige Vitest-Config statt Erweiterung von vite.config.ts: Letztere
// ist bewusst schlank für den Tauri-Dev-Server gehalten (siehe dortiger
// Kommentar) und bleibt so unangetastet.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
