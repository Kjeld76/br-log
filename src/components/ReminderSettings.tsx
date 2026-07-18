import { useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { secondaryBtnSmCls } from "../lib/ui";

// Einstellungs-Abschnitt "Kalender & Erinnerungen": Berechtigungsstatus der
// System-Benachrichtigungen + Erklärung, wie weit Erinnerungen ohne externe
// Dienste tragen (Desktop: nur solange die App läuft; Verpasstes wird beim
// Start nachgeholt).
export default function ReminderSettings({ mobile }: { mobile: boolean }) {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    isPermissionGranted()
      .then((g) => {
        if (active) setGranted(g);
      })
      .catch(() => {
        if (active) setGranted(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const request = async () => {
    try {
      setGranted((await requestPermission()) === "granted");
    } catch {
      setGranted(false);
    }
  };

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-slate-600 dark:text-slate-300">
          System-Benachrichtigungen
        </span>
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
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Termin-Erinnerungen werden als Systembenachrichtigung angezeigt
        {mobile
          ? " – auf Android auch bei geschlossener App (geplante Benachrichtigungen)."
          : ", solange BR-Log läuft (auch minimiert oder gesperrt). "}
        {!mobile &&
          "Ist die App beendet, erscheinen verpasste Erinnerungen beim nächsten Start als Hinweis."}
      </p>
    </div>
  );
}
