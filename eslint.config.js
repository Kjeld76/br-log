// ESLint 9 Flat Config. Deckt nur src/ ab (Frontend); src-tauri/ hat seine
// eigene Rust-Toolchain (cargo clippy), dist/ ist Build-Output.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Nur die zwei klassischen Hook-Regeln (Regelverstöße, korrekte Deps).
      // eslint-plugin-react-hooks bündelt ab v6 zusätzlich die experimentellen
      // React-Compiler-Regeln (set-state-in-effect, purity, ...) im
      // "recommended"-Preset – die verlangen einen Effekt-Umbau in mehreren
      // Views (CalendarView, EntryList, LockScreen) und gehören nicht zum
      // Infrastruktur-Arbeitspaket, sondern in die jeweilige Fach-Änderung.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ungenutzte Funktionsparameter sind im Bestandscode üblich (z. B.
      // Callback-Signaturen von Tauri-Events) – Unterstrich-Präfix erlaubt sie
      // gezielt, alles andere bleibt ein Fehler.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Testdateien laufen unter Node/Vitest, nicht im Browser.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  }
);
