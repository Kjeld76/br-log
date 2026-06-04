import { useEffect, useState } from "react";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { getDbPathInfo } from "../db/client";
import { Icon } from "./Icon";

export default function DbInfoPanel() {
  const [dir, setDir] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [portable, setPortable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const info = await getDbPathInfo();
        setDir(info.dataDir);
        setDbPath(info.dbFile);
        setPortable(info.portable);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const reveal = async () => {
    setError(null);
    try {
      await revealItemInDir(dbPath);
    } catch {
      try {
        await openPath(dir);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const copyPath = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(dbPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const card =
    "rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800";
  const btn =
    "flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div className="space-y-5">
      <section className={card}>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Datenspeicher
          <span
            className={
              "rounded px-1.5 py-0.5 text-[11px] font-medium " +
              (portable
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300")
            }
          >
            {portable ? "Portabel (USB)" : "Installiert"}
          </span>
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Alle Daten liegen ausschließlich lokal auf diesem Gerät – es gibt keinen
          Server.
          {portable
            ? " Diese Version läuft portabel: Die Datenbank liegt im Ordner BR-Log-Data neben der EXE und wandert mit dem USB-Stick mit."
            : " Zum Sichern die Datei br_zeiten.db kopieren oder den JSON-Export nutzen."}
        </p>
        <div className="mt-2 break-all rounded bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          {dbPath || "Pfad wird ermittelt…"}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={copyPath} disabled={!dbPath}>
            {copied ? "Pfad kopiert ✓" : "Pfad kopieren"}
          </button>
          <button type="button" className={btn} onClick={reveal} disabled={!dbPath}>
            <Icon name="folder-open" size={16} />
            Ordner im Explorer öffnen
          </button>
        </div>
        {error && (
          <p className="mt-2 break-all text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Über
        </h3>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          BR-Log – Version 1.1.2
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          © 2026 Mario König. Alle Rechte vorbehalten.
          <br />
          Ersteller und Rechteinhaber: Mario König.
        </p>
      </section>
    </div>
  );
}
