import { defineConfig } from "vitest/config";

// Eigenständige Vitest-Config statt Erweiterung von vite.config.ts: Letztere
// ist bewusst schlank für den Tauri-Dev-Server gehalten (siehe dortiger
// Kommentar) und bleibt so unangetastet.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
