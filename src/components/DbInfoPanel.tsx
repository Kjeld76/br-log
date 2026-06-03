import { useEffect, useState } from "react";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";

export default function DbInfoPanel() {
  const [dir, setDir] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await appConfigDir();
        setDir(d);
        setDbPath(await join(d, "br_zeiten.db"));
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

  return (
    <div className="space-y-5">
      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Datenspeicher</h3>
        <p className="text-sm text-slate-600">
          Alle Daten liegen ausschließlich lokal auf diesem Gerät – es gibt keinen
          Server. Zum Sichern die Datei <code>br_zeiten.db</code> kopieren oder den
          JSON-Export nutzen.
        </p>
        <div className="mt-2 break-all rounded bg-slate-50 p-2 text-xs text-slate-700">
          {dbPath || "Pfad wird ermittelt…"}
        </div>
        <button
          type="button"
          className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          onClick={reveal}
          disabled={!dbPath}
        >
          Im Explorer anzeigen
        </button>
        {error && (
          <p className="mt-2 break-all text-xs text-red-600">{error}</p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Über</h3>
        <p className="text-sm text-slate-700">BR-Zeiten – Version 1.0.0</p>
        <p className="mt-2 text-sm text-slate-600">
          © 2026 Mario König. Alle Rechte vorbehalten.
          <br />
          Ersteller und Rechteinhaber: Mario König.
        </p>
      </section>
    </div>
  );
}
