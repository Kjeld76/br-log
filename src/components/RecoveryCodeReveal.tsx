import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { secondaryBtnSmCls } from "../lib/ui";

interface Props {
  code: string;
  /** Wird aufgerufen, sobald der Nutzer das Sichern bestätigt hat. */
  onConfirmed: () => void;
  confirmLabel?: string;
}

/**
 * Zeigt den Wiederherstellungs-Code EINMALIG groß an, bietet Kopieren / als TXT
 * speichern und erzwingt eine Bestätigung „Ich habe den Code gesichert", bevor
 * es weitergeht. Mit diesem Code ODER dem Passwort lässt sich die DB entsperren.
 */
export default function RecoveryCodeReveal({ code, onConfirmed, confirmLabel }: Props) {
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const saveTxt = async () => {
    setError(null);
    try {
      const path = await save({
        defaultPath: "BR-Log-Wiederherstellungs-Code.txt",
        filters: [{ name: "Textdatei", extensions: ["txt"] }],
      });
      if (!path) return;
      const content =
        "BR-Log – Wiederherstellungs-Code\r\n\r\n" +
        code +
        "\r\n\r\nSicher aufbewahren (nicht zusammen mit der Datenbank). Mit diesem " +
        "Code laesst sich die Datenbank auch ohne Passwort entsperren. Gehen " +
        "Passwort UND Code verloren, sind die Daten unwiderruflich verloren.\r\n";
      await invoke("write_text_file", { path, contents: content });
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const btn = secondaryBtnSmCls;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Wiederherstellungs-Code
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Notieren oder speichern Sie diesen Code jetzt – er wird nur dieses eine
          Mal angezeigt. Mit ihm können Sie die Daten auch bei vergessenem
          Passwort entsperren.
        </p>
      </div>

      <div className="select-all rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-center font-mono text-lg tracking-widest text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
        {code}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={copy}>
          {copied ? "Kopiert ✓" : "Kopieren"}
        </button>
        <button type="button" className={btn} onClick={saveTxt}>
          {saved ? "Gespeichert ✓" : "Als Textdatei speichern"}
        </button>
      </div>

      <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        Achtung: Gehen Passwort <strong>und</strong> Wiederherstellungs-Code
        verloren, sind die verschlüsselten Daten unwiderruflich verloren – es gibt
        keine Hintertür. Bewahren Sie den Code getrennt von der Datenbank auf.
      </p>

      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        Ich habe den Wiederherstellungs-Code sicher gespeichert.
      </label>

      <button
        type="button"
        className="w-full rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        disabled={!ack}
        onClick={onConfirmed}
      >
        {confirmLabel ?? "Weiter"}
      </button>

      {error && (
        <p className="break-all text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
