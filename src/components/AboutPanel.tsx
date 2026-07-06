import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import logo from "../assets/logo.png";

// Kompaktes Info-Modal (AppMenu -> "Über BR-Log"): Name+Logo, Version (via
// getVersion() -- dasselbe Muster, das zuvor in DbInfoPanel saß, siehe dort),
// Kurzzweck, Entwickler, Datenschutz-Zusicherung. Bewusst KEIN rechtliches
// Impressum (siehe Auftrag) -- reine Kurzinfo, kein Adress-/Kontaktblock.
export default function AboutPanel() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {
        /* Versionsanzeige ist nur Komfort -- kein Fehlerfall im UI. */
      });
  }, []);

  return (
    <div className="space-y-4 text-center">
      <img src={logo} alt="BR-Log" className="mx-auto h-16 w-auto" />
      <div>
        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
          BR-Log
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Version {version ?? "…"}
        </p>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Erfassung und Nachweis von Betriebsratszeiten nach BetrVG.
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Entwickler: Mario König
      </p>
      <p className="rounded bg-slate-50 p-2 text-xs text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
        Alle Daten bleiben ausschließlich lokal auf diesem Gerät – keine
        Cloud, kein Tracking.
      </p>
    </div>
  );
}
