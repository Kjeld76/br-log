import { useState } from "react";
import { type Theme, getStoredTheme, setTheme } from "../lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "System" },
];

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  const choose = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            className={
              "rounded px-3 py-1.5 text-sm transition " +
              (active
                ? "bg-sky-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
