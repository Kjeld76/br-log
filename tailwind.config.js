/** @type {import('tailwindcss').Config} */
export default {
  // dark:-Klassen (Restfälle) und Tokens hören auf DIESELBE Quelle.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        overlay: "var(--color-overlay)",
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-ink": "var(--color-text-primary)",
        "secondary-ink": "var(--color-text-secondary)",
        "disabled-ink": "var(--color-text-disabled)",
        "on-primary": "var(--color-on-primary)",
        link: "var(--color-link)",
        focus: "var(--color-focus-ring)",
        "info-surface": "var(--color-info-surface)",
        "success-surface": "var(--color-success-surface)",
        "success-ink": "var(--color-success-ink)",
        success: "var(--color-success)",
        "warning-surface": "var(--color-warning-surface)",
        "warning-ink": "var(--color-warning-ink)",
        warning: "var(--color-warning)",
        "error-surface": "var(--color-error-surface)",
        "error-ink": "var(--color-error-ink)",
        error: "var(--color-error)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
      },
      minHeight: {
        touch: "var(--touch-min)",
        "touch-pointer": "var(--touch-pointer)",
      },
      minWidth: { touch: "var(--touch-min)" },
      boxShadow: {
        "token-1": "var(--shadow-1)",
        "token-2": "var(--shadow-2)",
        "token-3": "var(--shadow-3)",
      },
      zIndex: {
        dropdown: "var(--z-dropdown)", sticky: "var(--z-sticky)",
        overlay: "var(--z-overlay)", modal: "var(--z-modal)",
        toast: "var(--z-toast)", tooltip: "var(--z-tooltip)",
      },
      transitionDuration: {
        fast: "150ms", normal: "300ms", slow: "500ms",
      },
    },
  },
  plugins: [],
};
