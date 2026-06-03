import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:br_zeiten.db";

let dbPromise: Promise<Database> | null = null;
let ftsAvailable = false;
let initPromise: Promise<void> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load(DB_URL);
  return dbPromise;
}

export function isFtsAvailable(): boolean {
  return ftsAvailable;
}

/**
 * Initialisiert die FTS5-Volltextsuche ZUR LAUFZEIT (nicht in der Migration),
 * damit ein fehlendes FTS5 im SQLite-Build NICHT das Laden der DB blockiert.
 * Erfolg -> FTS5-Modus. Fehler -> LIKE-Fallback (siehe repository.searchHits).
 */
export async function initSearch(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = await getDb();
    try {
      await db.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(entry_id UNINDEXED, public_content, secret_content)"
      );
      ftsAvailable = true;
    } catch (e) {
      ftsAvailable = false;
      // Bewusst nur eine Warnung: die App funktioniert mit LIKE-Fallback weiter.
      console.warn("FTS5 nicht verfügbar – Fallback auf LIKE-Suche.", e);
    }
  })();
  return initPromise;
}
