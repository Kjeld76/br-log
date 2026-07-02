import { useState } from "react";
import { type Theme, getStoredTheme, setTheme } from "../lib/theme";
import SegmentedControl from "./SegmentedControl";

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

  return <SegmentedControl options={OPTIONS} value={theme} onChange={choose} />;
}
