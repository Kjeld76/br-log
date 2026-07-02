import { useEffect, useRef, useState } from "react";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { getDbPathInfo, backupNow } from "../db/client";
import { deletePlaintextBackup } from "../lib/auth";
import { toUserMessage } from "../lib/errors";
import { Icon } from "./Icon";

export default function DbInfoPanel() {
  const [dir, setDir] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [portable, setPortable] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  // Finding 54 (Nebenbefund): copied-Timeout wurde bei jedem Aufruf neu
  // gesetzt, ohne einen vorherigen zu clearen -- zwei schnelle Klicks auf
  // "Pfad kopieren" ließen die Bestätigung vorzeitig verschwinden.
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const info = await getDbPathInfo();
        setDir(info.dataDir);
        setDbPath(info.dbFile);
        setPortable(info.portable);
        setHasBackup(info.hasPlaintextBackup);
      } catch (e) {
        setError(toUserMessage(e));
      }
    })();
  }, []);

  const removeBackup = async () => {
    setError(null);
    try {
      await deletePlaintextBackup();
      setHasBackup(false);
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  const reveal = async () => {
    setError(null);
    try {
      await revealItemInDir(dbPath);
    } catch {
      try {
        await openPath(dir);
      } catch (e) {
        setError(toUserMessage(e));
      }
    }
  };

  const copyPath = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(dbPath);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1500);
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  // Manuelles Sofort-Backup über denselben Rust-Command wie das automatische
  // Backup beim Entsperren (Finding 6): trivial, weil er nur den bestehenden
  // db_backup-Aufruf wiederverwendet.
  const runBackup = async () => {
    setError(null);
    setBackupStatus(null);
    setBackupBusy(true);
    try {
      const path = await backupNow();
      setBackupStatus(`Gesichert nach: ${path}`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBackupBusy(false);
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
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            Verschlüsselt
          </span>
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Alle Daten liegen ausschließlich lokal auf diesem Gerät – es gibt keinen
          Server. Die Datenbank ist mit SQLCipher (AES-256) verschlüsselt; der
          Schlüssel dazu liegt gekapselt in der Datei keyfile.json im selben
          Ordner. Eine Kopie{" "}
          <strong>nur der Datenbank</strong> ist ohne diese Schlüsseldatei
          nicht entschlüsselbar – auch nicht mit dem Wiederherstellungs-Code,
          der ebenfalls auf die Schlüsseldaten in keyfile.json angewiesen ist.
          {portable
            ? " Diese Version läuft portabel: Datenbank UND keyfile.json liegen zusammen im Ordner BR-Log-Data neben der EXE und wandern mit dem USB-Stick mit."
            : " Für ein manuelles Backup deshalb immer br_zeiten.db UND keyfile.json zusammen sichern (liegen im selben Ordner)."}{" "}
          Schlüsselunabhängig ist der JSON-Export unter „Daten → Sicherung &amp;
          Übertragung" – er braucht weder keyfile.json noch Passwort.
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Zusätzlich legt die App bei jedem Entsperren automatisch eine
          Sicherung (Datenbank + keyfile.json) im Unterordner{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900/60">
            backups/
          </code>{" "}
          neben der Hauptdatenbank an – rotierend, die letzten 5 Stände
          bleiben erhalten. Zum Wiederherstellen bei geschlossener App die
          gewünschten Dateien aus <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900/60">backups/</code> zurück
          auf br_zeiten.db bzw. keyfile.json kopieren.
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
          <button type="button" className={btn} onClick={runBackup} disabled={backupBusy}>
            {backupBusy ? "Sichert…" : "Jetzt sichern"}
          </button>
        </div>
        {backupStatus && (
          <p className="mt-2 break-all rounded bg-green-50 px-2 py-1.5 text-xs text-green-800 dark:bg-green-900/20 dark:text-green-300">
            {backupStatus}
          </p>
        )}
        {hasBackup && (
          <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Aus der Verschlüsselung existiert noch eine{" "}
            <strong>unverschlüsselte</strong> Sicherungskopie
            (br_zeiten.db.pre-encrypt.bak). Erst löschen, wenn Passwort und
            Wiederherstellungs-Code sicher gespeichert sind.
            <button
              type="button"
              onClick={removeBackup}
              className="mt-2 block rounded border border-amber-300 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/50"
            >
              Klartext-Backup löschen
            </button>
          </div>
        )}
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
          BR-Log – Version 1.2.0
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
