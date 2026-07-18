import { useEffect, useRef, useState } from "react";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { getDbPathInfo, backupNow } from "../db/client";
import { rebuildFts } from "../db/repository";
import { deletePlaintextBackup } from "../lib/auth";
import { toUserMessage } from "../lib/errors";
import { secondaryBtnSmCls } from "../lib/ui";
import { Icon } from "./Icon";

interface Props {
  // Konvention (siehe App.tsx): isAndroid() wird zentral EINMAL in App.tsx
  // ermittelt und als Prop durchgereicht -- diese Komponente fragt es nicht
  // selbst ab.
  mobile: boolean;
}

export default function DbInfoPanel({ mobile }: Props) {
  const [dir, setDir] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [portable, setPortable] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
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

  // Finding 51: rebuildFts existierte bereits im Repository (Wartungswerkzeug
  // für den FTS-Suchindex), hatte aber keinen Aufrufer -- der im W1-Review
  // vorgesehene Verwendungszweck (manueller "Suchindex neu aufbauen"-Button)
  // war nie verdrahtet.
  const runRebuildIndex = async () => {
    setError(null);
    setIndexStatus(null);
    setIndexBusy(true);
    try {
      await rebuildFts();
      setIndexStatus("Suchindex neu aufgebaut.");
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setIndexBusy(false);
    }
  };

  const card = "rounded border border-border bg-surface p-4";
  const btn = "flex items-center gap-1.5 " + secondaryBtnSmCls + " disabled:opacity-50";

  return (
    <div className="space-y-5">
      <section className={card}>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary-ink">
          Datenspeicher
          <span
            className={
              "rounded px-1.5 py-0.5 text-[11px] font-medium " +
              (portable
                ? "bg-success-surface text-emerald-700 dark:text-emerald-300"
                : "bg-surface-2 text-secondary-ink")
            }
          >
            {portable ? "Portabel (USB)" : "Installiert"}
          </span>
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-outline-ink dark:bg-sky-900/40">
            Verschlüsselt
          </span>
        </h3>
        <p className="text-sm text-secondary-ink">
          Alle Daten liegen ausschließlich lokal auf diesem Gerät – es gibt keinen
          Server. Die Datenbank ist mit SQLCipher (AES-256) verschlüsselt; der
          Schlüssel dazu liegt gekapselt in der Datei keyfile.json im selben
          Ordner. Eine Kopie{" "}
          <strong>nur der Datenbank</strong> ist ohne diese Schlüsseldatei
          nicht entschlüsselbar – auch nicht mit dem Wiederherstellungs-Code,
          der ebenfalls auf die Schlüsseldaten in keyfile.json angewiesen ist.
          {mobile
            ? " Auf Android liegen beide Dateien in der App-eigenen Sandbox – ohne Root-Zugriff für Nutzer weder erreichbar noch manuell kopierbar (siehe Warnhinweis unten)."
            : portable
              ? " Diese Version läuft portabel: Datenbank UND keyfile.json liegen zusammen im Ordner BR-Log-Data neben der EXE und wandern mit dem USB-Stick mit."
              : " Für ein manuelles Backup deshalb immer br_zeiten.db UND keyfile.json zusammen sichern (liegen im selben Ordner)."}{" "}
          Schlüsselunabhängig ist der JSON-Export unter „Daten → Export &amp;
          Backup" – er braucht weder keyfile.json noch Passwort.
        </p>
        <p className="mt-2 text-sm text-secondary-ink">
          Zusätzlich legt die App bei jedem Entsperren automatisch eine
          Sicherung (Datenbank + keyfile.json) im Unterordner{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900/60">
            backups/
          </code>{" "}
          {mobile ? "an" : "neben der Hauptdatenbank an"} – rotierend, die
          letzten 5 Stände bleiben erhalten.{" "}
          {mobile
            ? "Auf Android liegt dieser Ordner in der App-Sandbox: für Nutzer nicht erreichbar und beim Deinstallieren der App unwiederbringlich mitgelöscht – kein Ersatz für ein externes Backup."
            : <>Zum Wiederherstellen bei geschlossener App die gewünschten
                Dateien aus <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900/60">backups/</code> zurück
                auf br_zeiten.db bzw. keyfile.json kopieren.</>}
        </p>
        {mobile && (
          <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <strong>Achtung:</strong> Beim Deinstallieren der App werden
            Datenbank, Schlüsseldatei und automatische Backups
            unwiederbringlich gelöscht – regelmäßig ein JSON-Backup
            exportieren und außerhalb des Geräts sichern.
          </div>
        )}
        <div className="mt-2 break-all rounded bg-surface-dim p-2 text-xs text-slate-700 dark:text-slate-300">
          {dbPath || "Pfad wird ermittelt…"}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={copyPath} disabled={!dbPath}>
            {copied ? "Pfad kopiert ✓" : "Pfad kopieren"}
          </button>
          {!mobile && (
            <button type="button" className={btn} onClick={reveal} disabled={!dbPath}>
              <Icon name="folder-open" size={16} />
              Ordner im Dateimanager öffnen
            </button>
          )}
          <button type="button" className={btn} onClick={runBackup} disabled={backupBusy}>
            {backupBusy ? "Sichert…" : "Jetzt sichern"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={runRebuildIndex}
            disabled={indexBusy}
            title="Baut den Volltext-Suchindex aus dem Datenbestand neu auf (Wartung, z. B. nach einem Wiederherstellen)"
          >
            {indexBusy ? "Baut Index…" : "Suchindex neu aufbauen"}
          </button>
        </div>
        {backupStatus && (
          <p className="mt-2 break-all rounded bg-green-50 px-2 py-1.5 text-xs text-green-800 dark:bg-green-900/20 dark:text-green-300">
            {backupStatus}
          </p>
        )}
        {indexStatus && (
          <p className="mt-2 break-all rounded bg-green-50 px-2 py-1.5 text-xs text-green-800 dark:bg-green-900/20 dark:text-green-300">
            {indexStatus}
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
              className="mt-2 block rounded border border-warning-action-line px-2 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50"
            >
              Klartext-Backup löschen
            </button>
          </div>
        )}
        {error && (
          <p className="mt-2 break-all text-xs text-danger-ink">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
