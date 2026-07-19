import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import logo from "../assets/logo.png";
import { toUserMessage } from "../lib/errors";
import { secondaryBtnSmCls } from "../lib/ui";

// Kompaktes Info-Modal (AppMenu -> "Über BR-Log"): Name+Logo, Version (via
// getVersion() -- dasselbe Muster, das zuvor in DbInfoPanel saß, siehe dort),
// Kurzzweck, Entwickler, Datenschutz-Zusicherung. Bewusst KEIN rechtliches
// Impressum (siehe Auftrag) -- reine Kurzinfo, kein Adress-/Kontaktblock.
export default function AboutPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [donateError, setDonateError] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {
        /* Versionsanzeige ist nur Komfort -- kein Fehlerfall im UI. */
      });
  }, []);

  // Freiwillige Spenden-Links (kein Verkauf, keine Paywall -- BR-Log bleibt
  // kostenlos). openUrl statt <a href> öffnet zuverlässig den System-Standard-
  // browser (Desktop UND Android), siehe DbInfoPanel für dasselbe
  // Fehlerbehandlungs-Muster (toUserMessage, kein Crash bei Fehlschlag). Die
  // Capability-Scope in src-tauri/capabilities/default.json ist bewusst eng
  // auf genau diese zwei Domains begrenzt.
  const donate = async (url: string) => {
    setDonateError(null);
    try {
      await openUrl(url);
    } catch (e) {
      setDonateError(toUserMessage(e));
    }
  };

  return (
    <div className="space-y-4 text-center">
      <img src={logo} alt="BR-Log" className="mx-auto h-16 w-auto" />
      <div>
        <p className="text-base font-semibold text-primary-ink">
          BR-Log
        </p>
        <p className="text-sm text-secondary-ink">
          Version {version ?? "…"}
        </p>
      </div>
      <p className="text-sm text-secondary-ink">
        Erfassung und Nachweis von Betriebsratszeiten nach BetrVG.
      </p>
      <p className="text-sm text-secondary-ink">
        Entwickler: Mario König
      </p>
      <p className="text-xs text-secondary-ink">
        Lizenz: GPLv3
      </p>
      <div className="space-y-2">
        <p className="text-xs text-secondary-ink">
          BR-Log ist kostenlos. Wenn es dir hilft, freue ich mich über einen
          Kaffee:
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={secondaryBtnSmCls}
            aria-label="Ko-fi in deinem Standard-Browser öffnen (freiwillige Spende)"
            onClick={() => donate("https://ko-fi.com/mariokoenig")}
          >
            Ko-fi
          </button>
          <button
            type="button"
            className={secondaryBtnSmCls}
            aria-label="Buy Me a Coffee in deinem Standard-Browser öffnen (freiwillige Spende)"
            onClick={() => donate("https://buymeacoffee.com/mariokoenig")}
          >
            Buy Me a Coffee
          </button>
        </div>
        {donateError && (
          <p className="text-xs text-danger-ink">{donateError}</p>
        )}
      </div>
      <p className="rounded bg-surface-dim p-2 text-xs text-secondary-ink">
        Alle Daten bleiben ausschließlich lokal auf diesem Gerät – keine
        Cloud, kein Tracking.
      </p>
    </div>
  );
}
