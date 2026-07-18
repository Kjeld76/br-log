import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { secondaryBtnSmCls } from "../lib/ui";

interface AppSettings {
  closeToTray: boolean;
}

// Einstellungs-Abschnitt "Kalender & Erinnerungen": Berechtigungsstatus der
// System-Benachrichtigungen, Desktop-Hintergrundbetrieb (Tray + Autostart)
// und Erklärung, wie weit Erinnerungen ohne externe Dienste tragen.
export default function ReminderSettings({ mobile }: { mobile: boolean }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    isPermissionGranted()
      .then((g) => {
        if (active) setGranted(g);
      })
      .catch(() => {
        if (active) setGranted(false);
      });
    if (!mobile) {
      invoke<AppSettings>("app_settings_get")
        .then((s) => {
          if (active) setCloseToTray(s.closeToTray);
        })
        .catch(() => {
          if (active) setCloseToTray(false);
        });
      // Autostart-Plugin dynamisch laden -- existiert nur im Desktop-Build.
      import("@tauri-apps/plugin-autostart")
        .then((auto) => auto.isEnabled())
        .then((enabled) => {
          if (active) setAutostart(enabled);
        })
        .catch(() => {
          if (active) setAutostart(false);
        });
    }
    return () => {
      active = false;
    };
  }, [mobile]);

  const request = async () => {
    try {
      setGranted((await requestPermission()) === "granted");
    } catch {
      setGranted(false);
    }
  };

  const toggleCloseToTray = async (next: boolean) => {
    const prev = closeToTray;
    setCloseToTray(next);
    try {
      await invoke("app_settings_set", { settings: { closeToTray: next } });
    } catch {
      setCloseToTray(prev); // Schreibfehler -> Schalter zurück
    }
  };

  const toggleAutostart = async (next: boolean) => {
    const prev = autostart;
    setAutostart(next);
    try {
      const auto = await import("@tauri-apps/plugin-autostart");
      if (next) await auto.enable();
      else await auto.disable();
    } catch {
      setAutostart(prev);
    }
  };

  const rowCls = "flex flex-wrap items-center justify-between gap-3";
  const labelCls = "text-slate-600 dark:text-slate-300";

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
      <div className={rowCls}>
        <span className={labelCls}>System-Benachrichtigungen</span>
        {granted === null ? (
          <span className="text-slate-400">…</span>
        ) : granted ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Erlaubt
          </span>
        ) : (
          <button type="button" className={secondaryBtnSmCls} onClick={() => void request()}>
            Erlauben
          </button>
        )}
      </div>

      {!mobile && (
        <>
          <label className={rowCls}>
            <span className={labelCls}>
              Beim Schließen im Hintergrund weiterlaufen (Tray)
            </span>
            <input
              type="checkbox"
              checked={closeToTray ?? false}
              disabled={closeToTray === null}
              onChange={(e) => void toggleCloseToTray(e.target.checked)}
            />
          </label>
          <label className={rowCls}>
            <span className={labelCls}>Beim Anmelden automatisch starten</span>
            <input
              type="checkbox"
              checked={autostart ?? false}
              disabled={autostart === null}
              onChange={(e) => void toggleAutostart(e.target.checked)}
            />
          </label>
        </>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {mobile
          ? "Termin-Erinnerungen werden als Systembenachrichtigung geplant und erscheinen auch bei geschlossener App. Nach einem Neustart des Geräts werden sie beim nächsten Öffnen neu geplant; Verpasstes erscheint als Hinweis in der App."
          : "Termin-Erinnerungen erscheinen als Systembenachrichtigung, solange BR-Log läuft – auch minimiert, gesperrt oder im Tray. Mit beiden Schaltern oben kommen Erinnerungen praktisch immer; die Datenbank bleibt im Hintergrund selbstverständlich gesperrt. Ist die App beendet, erscheinen verpasste Erinnerungen beim nächsten Start als Hinweis."}
      </p>
    </div>
  );
}
