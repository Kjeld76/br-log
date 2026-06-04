import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_STATEMENTS } from "./schema";

const DB_URL = "sqlite:br_zeiten.db";

let dbPromise: Promise<Database> | null = null;
let ftsAvailable = false;
let initPromise: Promise<void> | null = null;
let schemaPromise: Promise<void> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load(DB_URL);
  return dbPromise;
}

/**
 * Legt das Schema idempotent an (CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE).
 * Ersetzt die früheren prüfsummen-validierten Migrationen von tauri-plugin-sql,
 * die je nach Zeilenenden (CRLF/LF) / Build-Umgebung unterschiedliche Prüfsummen
 * erzeugten und bestehende DBs mit "migration ... has been modified" brachen.
 */
export async function initSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const db = await getDb();
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.execute(stmt);
    }
  })();
  return schemaPromise;
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
