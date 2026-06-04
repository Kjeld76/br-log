import { invoke } from "@tauri-apps/api/core";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * Dünner Datenbank-Shim. Bildet exakt das frühere `@tauri-apps/plugin-sql`-
 * Interface nach (`execute(sql, params)` / `select<T>(sql, params)`), routet aber
 * auf die eigenen Rust-Commands `db_execute` / `db_select` (rusqlite mit
 * gebundeltem SQLite). Dadurch bleibt `repository.ts` unverändert.
 *
 * Hintergrund des Umbaus weg von tauri-plugin-sql/sqlx:
 *  - gemeinsame Basis für portablen absoluten DB-Pfad (Issue #1) und spätere
 *    SQLCipher-Verschlüsselung,
 *  - FTS5 durch das gebundelte SQLite deterministisch verfügbar,
 *  - keine prüfsummen-validierten Migrationen mehr (Schema idempotent in schema.ts).
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<number>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

const db: Db = {
  execute(sql, params = []) {
    return invoke<number>("db_execute", { sql, params });
  },
  select<T>(sql: string, params: unknown[] = []) {
    return invoke<T>("db_select", { sql, params });
  },
};

let ftsAvailable = false;
let initPromise: Promise<void> | null = null;
let schemaPromise: Promise<void> | null = null;

export function getDb(): Promise<Db> {
  return Promise.resolve(db);
}

/**
 * Setzt die Init-Caches zurück. Nach jedem Entsperren (Phase 2) wird eine NEUE
 * keyed Connection geöffnet; Schema/FTS müssen dann erneut idempotent laufen.
 */
export function resetDbCaches(): void {
  schemaPromise = null;
  initPromise = null;
  ftsAvailable = false;
}

/**
 * Legt das Schema idempotent an (CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE).
 * Ersetzt die früheren prüfsummen-validierten Migrationen, die je nach
 * Zeilenenden (CRLF/LF) / Build-Umgebung unterschiedliche Prüfsummen erzeugten
 * und bestehende DBs mit "migration ... has been modified" brachen.
 */
export async function initSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
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
 * Mit dem gebundelten SQLite (rusqlite "bundled") ist FTS5 i. d. R. vorhanden.
 */
export async function initSearch(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
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

/** DB-Pfad + Modus (portabel/installiert), wie von Rust ermittelt. */
export interface DbPathInfo {
  dbFile: string;
  dataDir: string;
  portable: boolean;
  hasPlaintextBackup: boolean;
}

let dbPathPromise: Promise<DbPathInfo> | null = null;

/**
 * Absoluter DB-Pfad + Modus, von Rust bestimmt (portabler USB-Modus vs.
 * Installation). Für die Anzeige im DbInfoPanel; session-weit gecacht.
 */
export function getDbPathInfo(): Promise<DbPathInfo> {
  if (!dbPathPromise) dbPathPromise = invoke<DbPathInfo>("db_path");
  return dbPathPromise;
}
