import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri erwartet einen festen Dev-Port und ignoriert das src-tauri-Verzeichnis.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  // Tauri-CLI-Ausgaben nicht überschreiben
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // src-tauri nicht beobachten (Rust-Seite hat eigenen Watcher)
      ignored: ["**/src-tauri/**"],
    },
  },
}));
