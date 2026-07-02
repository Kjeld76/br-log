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
/** Ein einzelnes Schreib-Statement einer atomaren Batch-Transaktion. */
export interface BatchStatement {
  sql: string;
  params: unknown[];
}

export interface Db {
  execute(sql: string, params?: unknown[]): Promise<number>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  /** Führt mehrere Statements ATOMAR in EINER Transaktion aus (Rust: db_batch). */
  batch(statements: BatchStatement[]): Promise<void>;
}

const db: Db = {
  execute(sql, params = []) {
    return invoke<number>("db_execute", { sql, params });
  },
  select<T>(sql: string, params: unknown[] = []) {
    return invoke<T>("db_select", { sql, params });
  },
  batch(statements) {
    return invoke<void>("db_batch", { statements });
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
 * Legt das v0-Basisschema idempotent an (CREATE TABLE IF NOT EXISTS /
 * INSERT OR IGNORE) und führt anschließend die nummerierten Rust-Migrationen aus
 * (db_migrate, PRAGMA user_version). So erreichen künftige Schemaänderungen auch
 * Bestands-DBs zuverlässig, statt still auseinanderzudriften.
 *
 * Ein abgelehntes Promise wird NICHT dauerhaft gecacht: ein transienter Fehler
 * (z. B. kurzer Lock) lässt sich per erneutem Aufruf wiederholen.
 */
export async function initSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  const p = (async () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.execute(stmt);
    }
    await invoke("db_migrate");
  })();
  schemaPromise = p;
  p.catch(() => {
    if (schemaPromise === p) schemaPromise = null;
  });
  return p;
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
  const p = (async () => {
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
    // Suchindex mit dem Datenbestand abgleichen (fehlende Einträge nachtragen,
    // Geisterzeilen entfernen) – deckt Migrationen und einen erstmalig
    // verfügbaren FTS5-Build ab. Dynamischer Import bricht die statische
    // Zyklus-Abhängigkeit zu repository.ts.
    if (ftsAvailable) {
      try {
        const repo = await import("./repository");
        await repo.reconcileFts();
      } catch (e) {
        console.warn("FTS-Abgleich übersprungen.", e);
      }
    }
  })();
  initPromise = p;
  p.catch(() => {
    if (initPromise === p) initPromise = null;
  });
  return p;
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
  if (!dbPathPromise) {
    const p = invoke<DbPathInfo>("db_path");
    dbPathPromise = p;
    // Abgelehntes Promise nicht dauerhaft cachen -> Retry nach transientem Fehler.
    p.catch(() => {
      if (dbPathPromise === p) dbPathPromise = null;
    });
  }
  return dbPathPromise;
}
