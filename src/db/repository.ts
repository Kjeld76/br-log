import { getDb, isFtsAvailable, type Db, type BatchStatement } from "./client";
import { buildPublicContent, buildSecretContent, buildFtsMatch } from "./ftsContent";
import type {
  TimeEntry,
  TaskTag,
  Objection,
  EntryListItem,
  EntryFullItem,
  EntryFilter,
  SearchHit,
  BackupPayload,
  ImportSummary,
} from "../types";

// ---------- Roh-Zeilentypen (snake_case wie in SQLite) ----------

// Schlanke Eintragszeile OHNE secret_details – für Listen/Kalender/Suche.
interface EntryListRow {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  info_for_management: string;
  had_planned_shift: number;
  shift_compensation_note: string;
  is_compensation: number;
  created_at: string;
  updated_at: string;
}

// Vollständige Eintragszeile inkl. secret_details – für Detail/Backup/Voll-Export/FTS.
interface EntryRow extends EntryListRow {
  secret_details: string;
}

// Explizite Spaltenlisten (alias `e`): Der Listen-/Kalender-/Suchpfad lädt
// secret_details NICHT (Vertraulichkeitsschutz strukturell verankert), der
// Voll-Pfad (Detail/Backup/Voll-Export) lädt es zusätzlich.
const LIST_ENTRY_COLUMNS =
  "e.id, e.date, e.start_time, e.end_time, e.duration_minutes, " +
  "e.info_for_management, e.had_planned_shift, e.shift_compensation_note, " +
  "e.is_compensation, e.created_at, e.updated_at";
const FULL_ENTRY_COLUMNS = LIST_ENTRY_COLUMNS + ", e.secret_details";

interface ObjectionRow {
  id: string;
  entry_id: string;
  reason: string;
  by_whom: string;
  date: string | null;
}

// ---------- Hilfen ----------

function generateId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newEntry(dateIso: string): TimeEntry {
  const now = nowIso();
  return {
    id: generateId(),
    date: dateIso,
    startTime: null,
    endTime: null,
    durationMinutes: 0,
    infoForManagement: "",
    secretDetails: "",
    hadPlannedShift: true,
    shiftCompensationNote: "",
    isCompensation: false,
    tagIds: [],
    objections: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newObjection(): Objection {
  return { id: generateId(), reason: "", byWhom: "", date: null };
}

function mapListEntry(
  r: EntryListRow,
  tags: { id: string; label: string }[],
  objs: Objection[]
): EntryListItem {
  return {
    id: r.id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    durationMinutes: r.duration_minutes,
    infoForManagement: r.info_for_management,
    hadPlannedShift: r.had_planned_shift === 1,
    shiftCompensationNote: r.shift_compensation_note,
    isCompensation: r.is_compensation === 1,
    tagIds: tags.map((t) => t.id),
    tagLabels: tags.map((t) => t.label),
    objections: objs,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFullEntry(
  r: EntryRow,
  tags: { id: string; label: string }[],
  objs: Objection[]
): EntryFullItem {
  return {
    ...mapListEntry(r, tags, objs),
    secretDetails: r.secret_details,
  };
}

/** Chunk-Größe für IN-(?)-Listen: hält gebundene Parameter deutlich unter dem
 *  SQLite-Limit (32766), auch bei sehr vielen Einträgen/Suchtreffern. */
const IN_CHUNK = 500;

/**
 * Führt eine IN-(?)-Abfrage über in 500er-Blöcke aufgeteilte ID-Listen aus und
 * vereint die Ergebniszeilen. Verhindert "too many SQL variables" bei großen Listen.
 */
async function selectByIdChunks<Row>(
  db: Db,
  ids: string[],
  sqlFor: (placeholders: string) => string
): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const part = await db.select<Row[]>(sqlFor(ph), chunk);
    out.push(...part);
  }
  return out;
}

/** Lädt Schlagwort-Labels und Widersprüche für die übergebenen Eintrags-IDs. */
async function loadRelations(ids: string[]): Promise<{
  tagsByEntry: Map<string, { id: string; label: string }[]>;
  objByEntry: Map<string, Objection[]>;
}> {
  const db = await getDb();
  const tagRows = await selectByIdChunks<{
    entry_id: string;
    id: string;
    label: string;
  }>(
    db,
    ids,
    (ph) => `SELECT et.entry_id, t.id, t.label
       FROM entry_tags et JOIN task_tags t ON t.id = et.tag_id
      WHERE et.entry_id IN (${ph})`
  );
  const objRows = await selectByIdChunks<ObjectionRow>(
    db,
    ids,
    (ph) =>
      `SELECT id, entry_id, reason, by_whom, date FROM objections WHERE entry_id IN (${ph})`
  );

  const tagsByEntry = new Map<string, { id: string; label: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByEntry.get(t.entry_id) || [];
    arr.push({ id: t.id, label: t.label });
    tagsByEntry.set(t.entry_id, arr);
  }
  const objByEntry = new Map<string, Objection[]>();
  for (const o of objRows) {
    const arr = objByEntry.get(o.entry_id) || [];
    arr.push({ id: o.id, reason: o.reason, byWhom: o.by_whom, date: o.date });
    objByEntry.set(o.entry_id, arr);
  }
  return { tagsByEntry, objByEntry };
}

/** Schlanke Listen-Items (OHNE secretDetails) aus Listen-Rohzeilen. */
async function hydrateListEntries(
  rows: EntryListRow[]
): Promise<EntryListItem[]> {
  if (rows.length === 0) return [];
  const { tagsByEntry, objByEntry } = await loadRelations(rows.map((r) => r.id));
  return rows.map((r) =>
    mapListEntry(r, tagsByEntry.get(r.id) || [], objByEntry.get(r.id) || [])
  );
}

/** Vollständige Items (inkl. secretDetails) aus Voll-Rohzeilen. */
async function hydrateFullEntries(rows: EntryRow[]): Promise<EntryFullItem[]> {
  if (rows.length === 0) return [];
  const { tagsByEntry, objByEntry } = await loadRelations(rows.map((r) => r.id));
  return rows.map((r) =>
    mapFullEntry(r, tagsByEntry.get(r.id) || [], objByEntry.get(r.id) || [])
  );
}

// ---------- FTS-Pflege (Statement-Bausteine für db_batch) ----------

/** DELETE+INSERT der FTS-Zeile eines Eintrags (leer, falls FTS5 nicht verfügbar). */
function ftsUpsertStatements(args: {
  entryId: string;
  infoForManagement: string;
  tagLabels: string[];
  objections: { reason: string; byWhom: string }[];
  secretDetails: string;
}): BatchStatement[] {
  if (!isFtsAvailable()) return [];
  const publicContent = buildPublicContent({
    infoForManagement: args.infoForManagement,
    tagLabels: args.tagLabels,
    objections: args.objections,
  });
  const secretContent = buildSecretContent(args.secretDetails);
  return [
    { sql: "DELETE FROM entries_fts WHERE entry_id = ?", params: [args.entryId] },
    {
      sql: "INSERT INTO entries_fts (entry_id, public_content, secret_content) VALUES (?,?,?)",
      params: [args.entryId, publicContent, secretContent],
    },
  ];
}

/**
 * Baut alle Statements, um EINEN Eintrag zu schreiben (Eintragszeile, Schlagwort-
 * und Widerspruchs-Zuordnungen, FTS-Index) – als atomare Einheit für db_batch.
 * `tagLabelById` enthält die gültigen (existierenden) Tags; Referenzen auf nicht
 * (mehr) existierende Tags werden verworfen, damit die Fremdschlüssel halten.
 */
function entryWriteStatements(args: {
  entry: TimeEntry;
  exists: boolean;
  updatedAt: string;
  createdAtDefault: string;
  tagLabelById: Map<string, string>;
}): BatchStatement[] {
  const { entry, exists, updatedAt, createdAtDefault, tagLabelById } = args;
  const st: BatchStatement[] = [];
  const validTagIds = entry.tagIds.filter((id) => tagLabelById.has(id));
  const objs = entry.objections
    .filter((o) => o.reason.trim() || o.byWhom.trim())
    .map((o) => ({ ...o, id: o.id || generateId() }));

  if (exists) {
    st.push({
      sql: `UPDATE entries SET date=?, start_time=?, end_time=?, duration_minutes=?,
         info_for_management=?, secret_details=?, had_planned_shift=?,
         shift_compensation_note=?, is_compensation=?, updated_at=? WHERE id=?`,
      params: [
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.infoForManagement,
        entry.secretDetails,
        entry.hadPlannedShift ? 1 : 0,
        entry.shiftCompensationNote,
        entry.isCompensation ? 1 : 0,
        updatedAt,
        entry.id,
      ],
    });
  } else {
    st.push({
      sql: `INSERT INTO entries (id, date, start_time, end_time, duration_minutes,
         info_for_management, secret_details, had_planned_shift,
         shift_compensation_note, is_compensation, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [
        entry.id,
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.infoForManagement,
        entry.secretDetails,
        entry.hadPlannedShift ? 1 : 0,
        entry.shiftCompensationNote,
        entry.isCompensation ? 1 : 0,
        entry.createdAt || createdAtDefault,
        updatedAt,
      ],
    });
  }

  st.push({
    sql: "DELETE FROM entry_tags WHERE entry_id = ?",
    params: [entry.id],
  });
  for (const tagId of validTagIds) {
    st.push({
      sql: "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)",
      params: [entry.id, tagId],
    });
  }

  st.push({
    sql: "DELETE FROM objections WHERE entry_id = ?",
    params: [entry.id],
  });
  for (const o of objs) {
    st.push({
      sql: "INSERT INTO objections (id, entry_id, reason, by_whom, date) VALUES (?,?,?,?,?)",
      params: [o.id, entry.id, o.reason, o.byWhom, o.date],
    });
  }

  st.push(
    ...ftsUpsertStatements({
      entryId: entry.id,
      infoForManagement: entry.infoForManagement,
      tagLabels: validTagIds.map((id) => tagLabelById.get(id)!),
      objections: objs.map((o) => ({ reason: o.reason, byWhom: o.byWhom })),
      secretDetails: entry.secretDetails,
    })
  );
  return st;
}

/** Lädt (id -> label) für die übergebenen Tag-IDs; nur existierende Tags. */
async function loadTagLabels(
  db: Db,
  tagIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tagIds.length === 0) return map;
  const rows = await selectByIdChunks<{ id: string; label: string }>(
    db,
    tagIds,
    (ph) => `SELECT id, label FROM task_tags WHERE id IN (${ph})`
  );
  for (const r of rows) map.set(r.id, r.label);
  return map;
}

// ---------- Tags ----------

export async function listTags(includeArchived = false): Promise<TaskTag[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; label: string; archived: number }[]>(
    `SELECT id, label, archived FROM task_tags ${
      includeArchived ? "" : "WHERE archived = 0"
    } ORDER BY label COLLATE NOCASE`
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    archived: r.archived === 1,
  }));
}

export async function createTag(label: string): Promise<TaskTag> {
  const db = await getDb();
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Bitte ein Schlagwort eingeben.");
  // Case-insensitiver Vorab-Check gegen bestehende (auch archivierte) Labels –
  // das Schema hat kein UNIQUE, also verhindert das App-seitig Duplikate
  // (z. B. bei Doppel-Klick/Doppel-Enter im TagManager).
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM task_tags WHERE label = ? COLLATE NOCASE",
    [trimmed]
  );
  if (existing.length > 0) {
    throw new Error(`Schlagwort „${trimmed}“ existiert bereits.`);
  }
  const tag: TaskTag = { id: generateId(), label: trimmed, archived: false };
  await db.execute("INSERT INTO task_tags (id, label, archived) VALUES (?,?,0)", [
    tag.id,
    tag.label,
  ]);
  return tag;
}

export async function renameTag(id: string, label: string): Promise<void> {
  const db = await getDb();
  const trimmed = label.trim();
  // Label-Änderung + FTS-Nachzug aller betroffenen Einträge in EINER Transaktion.
  const statements: BatchStatement[] = [
    { sql: "UPDATE task_tags SET label = ? WHERE id = ?", params: [trimmed, id] },
  ];
  if (isFtsAvailable()) {
    const affected = await db.select<{ entry_id: string }[]>(
      "SELECT entry_id FROM entry_tags WHERE tag_id = ?",
      [id]
    );
    if (affected.length > 0) {
      const rows = await selectByIdChunks<EntryRow>(
        db,
        affected.map((a) => a.entry_id),
        (ph) => `SELECT * FROM entries WHERE id IN (${ph})`
      );
      const items = await hydrateFullEntries(rows);
      for (const it of items) {
        // Neues Label an der Position des umbenannten Tags einsetzen (die
        // hydrierten tagLabels tragen noch den alten Wert).
        const tagLabels = it.tagIds.map((tid, i) =>
          tid === id ? trimmed : it.tagLabels[i]
        );
        statements.push(
          ...ftsUpsertStatements({
            entryId: it.id,
            infoForManagement: it.infoForManagement,
            tagLabels,
            objections: it.objections.map((o) => ({
              reason: o.reason,
              byWhom: o.byWhom,
            })),
            secretDetails: it.secretDetails,
          })
        );
      }
    }
  }
  await db.batch(statements);
}

export async function setTagArchived(
  id: string,
  archived: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE task_tags SET archived = ? WHERE id = ?", [
    archived ? 1 : 0,
    id,
  ]);
}

// ---------- Einträge ----------

/** Lädt einen Eintrag VOLLSTÄNDIG (inkl. secretDetails) – für Detailansicht,
 *  Bearbeiten und Duplizieren. Listen liefern secretDetails bewusst nicht. */
export async function getEntry(id: string): Promise<EntryFullItem | null> {
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries WHERE id = ?", [
    id,
  ]);
  if (rows.length === 0) return null;
  const items = await hydrateFullEntries(rows);
  return items[0] ?? null;
}

/**
 * Speichert einen Eintrag samt Schlagwörtern, Widersprüchen und FTS-Index ATOMAR
 * (db_batch). `updatedAtOverride` erlaubt es, den updated_at-Stempel explizit zu
 * setzen (Default: jetzt); der Import nutzt das später zur Erhaltung des Originals.
 */
export async function saveEntry(
  entry: TimeEntry,
  updatedAtOverride?: string
): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const exists =
    (await db.select<{ id: string }[]>("SELECT id FROM entries WHERE id = ?", [
      entry.id,
    ])).length > 0;
  const tagLabelById = await loadTagLabels(db, entry.tagIds);
  const statements = entryWriteStatements({
    entry,
    exists,
    updatedAt: updatedAtOverride ?? now,
    createdAtDefault: now,
    tagLabelById,
  });
  await db.batch(statements);
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDb();
  // Kindzeilen + FTS-Index atomar mit dem Eintrag löschen. Die Fremdschlüssel
  // (ON DELETE CASCADE) sichern das zusätzlich ab; die expliziten DELETEs bleiben
  // als klare Absicht und decken den FTS-Index (kein FK-Bezug) mit ab.
  const statements: BatchStatement[] = [
    { sql: "DELETE FROM objections WHERE entry_id = ?", params: [id] },
    { sql: "DELETE FROM entry_tags WHERE entry_id = ?", params: [id] },
    { sql: "DELETE FROM entries WHERE id = ?", params: [id] },
  ];
  if (isFtsAvailable()) {
    statements.push({
      sql: "DELETE FROM entries_fts WHERE entry_id = ?",
      params: [id],
    });
  }
  await db.batch(statements);
}

// ---------- Suche (spaltengebundene Trefferherkunft, KEIN LIKE-Recheck im FTS-Pfad) ----------

async function searchHits(term: string): Promise<Map<string, SearchHit>> {
  const db = await getDb();
  const map = new Map<string, SearchHit>();
  const mark = (id: string, key: keyof SearchHit) => {
    const h = map.get(id) || { hasPublicHit: false, hasSecretHit: false };
    h[key] = true;
    map.set(id, h);
  };

  if (isFtsAvailable()) {
    const pub = buildFtsMatch("public_content", term);
    const sec = buildFtsMatch("secret_content", term);
    if (pub) {
      const r = await db.select<{ entry_id: string }[]>(
        "SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ?",
        [pub]
      );
      for (const x of r) mark(x.entry_id, "hasPublicHit");
    }
    if (sec) {
      const r = await db.select<{ entry_id: string }[]>(
        "SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ?",
        [sec]
      );
      for (const x of r) mark(x.entry_id, "hasSecretHit");
    }
  } else {
    // Kompletter Fallback NUR falls FTS5 im Build fehlt – getrennte Spalten-Logik via LIKE.
    const like = `%${term.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const pub = await db.select<{ id: string }[]>(
      `SELECT DISTINCT e.id FROM entries e
        WHERE e.info_for_management LIKE ? ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM entry_tags et JOIN task_tags t ON t.id=et.tag_id
                       WHERE et.entry_id=e.id AND t.label LIKE ? ESCAPE '\\')
           OR EXISTS (SELECT 1 FROM objections o WHERE o.entry_id=e.id
                       AND (o.reason LIKE ? ESCAPE '\\' OR o.by_whom LIKE ? ESCAPE '\\'))`,
      [like, like, like, like]
    );
    for (const x of pub) mark(x.id, "hasPublicHit");
    const sec = await db.select<{ id: string }[]>(
      "SELECT id FROM entries WHERE secret_details LIKE ? ESCAPE '\\'",
      [like]
    );
    for (const x of sec) mark(x.id, "hasSecretHit");
  }
  return map;
}

/**
 * Baut die gefilterten Eintrags-Rohzeilen (Zeitraum/Tags/Volltext) mit der
 * übergebenen Spaltenliste. `columns` steuert, ob secret_details geladen wird
 * (Listen-Pfad: nein; Voll-Pfad: ja). Liefert zusätzlich die Suchtreffer-Map.
 */
async function queryEntryRows<Row extends EntryListRow>(
  filter: EntryFilter,
  columns: string
): Promise<{ rows: Row[]; hitMap: Map<string, SearchHit> | null }> {
  const db = await getDb();
  const baseWhere: string[] = [];
  const baseParams: unknown[] = [];

  if (filter.from) {
    baseWhere.push("e.date >= ?");
    baseParams.push(filter.from);
  }
  if (filter.to) {
    baseWhere.push("e.date <= ?");
    baseParams.push(filter.to);
  }
  if (filter.tagIds && filter.tagIds.length > 0) {
    const ph = filter.tagIds.map(() => "?").join(",");
    baseWhere.push(
      `EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (${ph}))`
    );
    baseParams.push(...filter.tagIds);
  }

  const orderBy = "ORDER BY e.date DESC, e.start_time DESC";
  let hitMap: Map<string, SearchHit> | null = null;
  let rows: Row[];

  const term = filter.term?.trim();
  if (term) {
    hitMap = await searchHits(term);
    const ids = [...hitMap.keys()];
    if (ids.length === 0) return { rows: [], hitMap };
    // Treffer-IDs in 500er-Blöcken abfragen (Parameterlimit), Zeilen vereinen.
    rows = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const ph = chunk.map(() => "?").join(",");
      const where = [...baseWhere, `e.id IN (${ph})`];
      const sql = `SELECT ${columns} FROM entries e WHERE ${where.join(
        " AND "
      )} ${orderBy}`;
      const part = await db.select<Row[]>(sql, [...baseParams, ...chunk]);
      rows.push(...part);
    }
    // Über mehrere Blöcke hinweg erneut sortieren (SQL sortiert nur je Block).
    if (ids.length > IN_CHUNK) {
      rows.sort((a, b) =>
        a.date < b.date
          ? 1
          : a.date > b.date
          ? -1
          : (a.start_time ?? "") < (b.start_time ?? "")
          ? 1
          : (a.start_time ?? "") > (b.start_time ?? "")
          ? -1
          : 0
      );
    }
  } else {
    const sql = `SELECT ${columns} FROM entries e ${
      baseWhere.length ? "WHERE " + baseWhere.join(" AND ") : ""
    } ${orderBy}`;
    rows = await db.select<Row[]>(sql, baseParams);
  }

  return { rows, hitMap };
}

/**
 * Übersichtsliste OHNE secretDetails (schlanker Typ + explizite Spaltenliste).
 * Das BR-Geheimnis wird hier bewusst nicht geladen; wer es braucht (Detail,
 * Voll-Export), nutzt getEntry bzw. listEntriesFull.
 */
export async function listEntries(
  filter: EntryFilter
): Promise<EntryListItem[]> {
  const { rows, hitMap } = await queryEntryRows<EntryListRow>(
    filter,
    LIST_ENTRY_COLUMNS
  );
  const items = await hydrateListEntries(rows);
  if (hitMap) {
    for (const it of items) it.search = hitMap.get(it.id);
  }
  return items;
}

/**
 * Wie listEntries, aber inkl. secretDetails. AUSSCHLIESSLICH für den
 * vertraulichen Voll-CSV-Export – niemals für Listen-/Kalender-/Suchansichten.
 */
export async function listEntriesFull(
  filter: EntryFilter
): Promise<EntryFullItem[]> {
  const { rows, hitMap } = await queryEntryRows<EntryRow>(
    filter,
    FULL_ENTRY_COLUMNS
  );
  const items = await hydrateFullEntries(rows);
  if (hitMap) {
    for (const it of items) it.search = hitMap.get(it.id);
  }
  return items;
}

export async function daySums(
  from: string,
  to: string
): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select<{ date: string; mins: number }[]>(
    "SELECT date, SUM(duration_minutes) as mins FROM entries WHERE date >= ? AND date <= ? GROUP BY date",
    [from, to]
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.date] = r.mins;
  return out;
}

// ---------- Backup / Import ----------

function toTimeEntry(e: EntryFullItem): TimeEntry {
  return {
    id: e.id,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    durationMinutes: e.durationMinutes,
    infoForManagement: e.infoForManagement,
    secretDetails: e.secretDetails,
    hadPlannedShift: e.hadPlannedShift,
    shiftCompensationNote: e.shiftCompensationNote,
    isCompensation: e.isCompensation ?? false,
    tagIds: e.tagIds,
    objections: e.objections,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export async function getAllForBackup(): Promise<BackupPayload> {
  const db = await getDb();
  const tags = await listTags(true);
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries ORDER BY date");
  const entries = (await hydrateFullEntries(rows)).map(toTimeEntry);
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    app: "BR-Log",
    tags,
    entries,
  };
}

/**
 * Last-Writer-Wins-Entscheidung: gewinnt der importierte Eintrag gegen den
 * lokalen Stand? `localUpdated` ist `undefined`, wenn die ID lokal noch nicht
 * existiert (Import gewinnt immer). EINZIGE Implementierung dieser Regel --
 * analyzeImport (Vorschau) und applyImport (tatsächlicher Merge) nutzen
 * dieselbe Funktion, damit beide niemals auseinanderlaufen können (Finding 32).
 */
function importerWins(
  localUpdated: string | undefined,
  importedUpdatedAt: string
): boolean {
  return localUpdated === undefined || (importedUpdatedAt || "") > localUpdated;
}

export async function analyzeImport(
  payload: BackupPayload
): Promise<ImportSummary> {
  const db = await getDb();
  const localEntries = await db.select<{ id: string; updated_at: string }[]>(
    "SELECT id, updated_at FROM entries"
  );
  const localMap = new Map(localEntries.map((e) => [e.id, e.updated_at]));
  let newEntries = 0;
  let conflicts = 0;
  let unchanged = 0;
  const conflictIds: string[] = [];
  for (const e of payload.entries) {
    const localUpdated = localMap.get(e.id);
    if (localUpdated === undefined) newEntries++;
    else if (importerWins(localUpdated, e.updatedAt)) {
      conflicts++;
      conflictIds.push(e.id); // wird überschrieben
    } else unchanged++;
  }

  // Konflikt-Preview: konkrete lokale Einträge, die überschrieben würden.
  const conflictItems = [] as ImportSummary["conflictItems"];
  if (conflictIds.length > 0) {
    const rows = await selectByIdChunks<{
      id: string;
      date: string;
      info_for_management: string;
    }>(
      db,
      conflictIds,
      (ph) =>
        `SELECT e.id, e.date, e.info_for_management FROM entries e WHERE e.id IN (${ph})`
    );
    const labelById = new Map(
      rows.map((r) => [r.id, { date: r.date, info: r.info_for_management }])
    );
    // Schlagwort-Labels als Fallback-Beschreibung
    const tagRows = await selectByIdChunks<{ entry_id: string; label: string }>(
      db,
      conflictIds,
      (ph) =>
        `SELECT et.entry_id, t.label FROM entry_tags et JOIN task_tags t ON t.id = et.tag_id WHERE et.entry_id IN (${ph})`
    );
    const tagsById = new Map<string, string[]>();
    for (const tr of tagRows) {
      const arr = tagsById.get(tr.entry_id) || [];
      arr.push(tr.label);
      tagsById.set(tr.entry_id, arr);
    }
    for (const id of conflictIds) {
      const base = labelById.get(id);
      const tagLabels = (tagsById.get(id) || []).join(", ");
      const label =
        (base?.info && base.info.trim()) || tagLabels || "(ohne Beschreibung)";
      conflictItems.push({ id, date: base?.date ?? "?", label });
    }
  }

  // newTags exakt wie applyImport zählen: ein importiertes Tag wird NICHT
  // angelegt, wenn seine ID bereits existiert ODER sein Label (case-insensitiv)
  // schon vorkommt – auch Label-Dubletten innerhalb des Payloads zählen nur
  // einmal. Sonst zeigt die Vorschau mehr „neue Tags" an, als tatsächlich
  // angelegt werden (Divergenz Vorschau/Anwendung).
  const localTags = await db.select<{ id: string; label: string }[]>(
    "SELECT id, label FROM task_tags"
  );
  const localTagIds = new Set(localTags.map((t) => t.id));
  const knownLabels = new Set(localTags.map((t) => t.label.toLowerCase()));
  let newTags = 0;
  for (const t of payload.tags || []) {
    const key = t.label.toLowerCase();
    if (localTagIds.has(t.id) || knownLabels.has(key)) continue;
    knownLabels.add(key);
    newTags++;
  }
  return { newEntries, conflicts, unchanged, newTags, conflictItems };
}

/**
 * Führt den Merge aus: bei UUID-Kollision gewinnt der neuere updated_at
 * (importerWins, s.o. -- dieselbe Regel wie in analyzeImport). Der gesamte
 * Merge (Tags + Einträge + FTS) läuft in EINER Transaktion (db_batch) – kein
 * halb gemergter Zustand bei Abbruch. `precomputedSummary` erlaubt es, die
 * zuvor angezeigte Analyse wiederzuverwenden (die UI übergibt hier die in der
 * Import-Vorschau bereits berechnete Summary, s. ExportPanel.confirmImport) –
 * vermeidet die doppelte Ausführung der Konflikt-/Tag-Analyse beim bestätigten
 * Import (Finding 32). Die Gewinner-Ermittlung je Eintrag für den tatsächlichen
 * Schreibvorgang läuft dennoch separat (braucht den DB-Stand zum Apply-
 * Zeitpunkt, nicht nur die aggregierten Zahlen der Vorschau).
 */
export async function applyImport(
  payload: BackupPayload,
  precomputedSummary?: ImportSummary
): Promise<ImportSummary> {
  const summary = precomputedSummary ?? (await analyzeImport(payload));
  const db = await getDb();
  const now = nowIso();

  // Bestehende Tags: gültige IDs + Labels (id -> label) und case-insensitiver
  // Label-Index (verhindert eine UNIQUE-Verletzung beim Anlegen importierter Tags).
  const existingTags = await db.select<{ id: string; label: string }[]>(
    "SELECT id, label FROM task_tags"
  );
  const tagLabelById = new Map<string, string>();
  const knownLabels = new Set<string>();
  for (const t of existingTags) {
    tagLabelById.set(t.id, t.label);
    knownLabels.add(t.label.toLowerCase());
  }

  const statements: BatchStatement[] = [];

  // 1) Tags mergen: nur anlegen, wenn weder ID noch (case-insensitives) Label
  //    bereits existieren. Gleichnamige Tags mit fremder ID werden übersprungen
  //    (volle ID-Remap folgt einer späteren Welle); ihre Einträge verlieren die
  //    betroffene Zuordnung, statt die Import-Transaktion an der UNIQUE-Regel
  //    scheitern zu lassen.
  for (const t of payload.tags || []) {
    const key = t.label.toLowerCase();
    if (tagLabelById.has(t.id) || knownLabels.has(key)) continue;
    statements.push({
      sql: "INSERT OR IGNORE INTO task_tags (id, label, archived) VALUES (?,?,?)",
      params: [t.id, t.label, t.archived ? 1 : 0],
    });
    tagLabelById.set(t.id, t.label);
    knownLabels.add(key);
  }

  // 2) Einträge mergen.
  const localEntries = await db.select<{ id: string; updated_at: string }[]>(
    "SELECT id, updated_at FROM entries"
  );
  const localMap = new Map(localEntries.map((e) => [e.id, e.updated_at]));

  for (const e of payload.entries) {
    const localUpdated = localMap.get(e.id);
    const isNew = localUpdated === undefined;
    if (!importerWins(localUpdated, e.updatedAt)) continue; // lokal gleich/älter -> bleibt
    statements.push(
      ...entryWriteStatements({
        // Backup-Dateien können unvollständig sein -> Listen defensiv absichern.
        entry: { ...e, tagIds: e.tagIds ?? [], objections: e.objections ?? [] },
        exists: !isNew,
        // WICHTIG (Finding 10): den ORIGINALEN updated_at aus dem Backup
        // erhalten statt auf 'jetzt' zu stempeln. Sonst verfälscht jeder
        // Import die Zeitstempel aller übernommenen Einträge -> Last-Writer-
        // Wins vergleicht beim nächsten Sync den Import-Zeitpunkt statt des
        // echten Änderungszeitpunkts und kann neuere Änderungen eines anderen
        // Geräts mit einem älteren Stand überschreiben (siehe Finding-Text).
        updatedAt: e.updatedAt || now,
        createdAtDefault: now,
        tagLabelById,
      })
    );
  }

  await db.batch(statements);
  return summary;
}

/** Höchste vom Code verstandene Backup-Schema-Version (siehe getAllForBackup). */
const SUPPORTED_SCHEMA_VERSION = 1;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pflichtfeld-/Typprüfung je Import-Eintrag (Finding 1). Verhindert, dass eine
 * kaputte, handeditierte oder fremde Backup-Datei stillschweigend Datensätze
 * mit fehlender/leerer id (dupliziert bei jedem erneuten Import, weder
 * editier- noch löschbar), fehlendem/ungültigem Datum oder negativer/kaputter
 * Dauer in den Merge einspeist. Wirft mit einer konkreten, deutschen Meldung
 * VOR dem ersten Schreibzugriff, statt den Fehler erst als rohen SQL-/
 * Constraint-Fehler mitten in der Import-Transaktion zu erleben.
 */
function validateBackupEntry(raw: unknown, index: number): void {
  if (!isPlainObject(raw)) {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag ${index + 1} ist kein gültiges Objekt.`
    );
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag ${index + 1} hat keine gültige ID.`
    );
  }
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat kein gültiges Datum (erwartet JJJJ-MM-TT).`
    );
  }
  if (
    typeof raw.durationMinutes !== "number" ||
    !Number.isFinite(raw.durationMinutes) ||
    raw.durationMinutes < 0
  ) {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat eine ungültige Dauer.`
    );
  }
  if (raw.tagIds !== undefined && !Array.isArray(raw.tagIds)) {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat ungültige Schlagwort-Zuordnungen.`
    );
  }
  if (raw.objections !== undefined && !Array.isArray(raw.objections)) {
    throw new Error(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat ungültige Widersprüche.`
    );
  }
}

export function parseBackup(raw: string): BackupPayload {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Ungültige Backup-Datei: Die Datei enthält kein gültiges JSON.");
  }
  if (!isPlainObject(data) || !Array.isArray(data.entries)) {
    throw new Error("Ungültige Backup-Datei: 'entries' fehlt.");
  }
  // schemaVersion nur ablehnen, wenn sie explizit gesetzt UND neuer als
  // unterstützt ist (unbekannte künftige Version, die dieser Code-Stand nicht
  // versteht). Fehlt sie (ältere/manuell gebaute Datei), wird defensiv wie
  // Version 1 behandelt -- die eigentliche Härtung gegen kaputte/fremde
  // Dateien leisten die Feldprüfungen je Eintrag unten.
  if (
    data.schemaVersion !== undefined &&
    (typeof data.schemaVersion !== "number" ||
      data.schemaVersion > SUPPORTED_SCHEMA_VERSION)
  ) {
    throw new Error(
      `Ungültige Backup-Datei: Unbekannte Schema-Version (${String(
        data.schemaVersion
      )}). Diese App-Version unterstützt Backups bis Version ${SUPPORTED_SCHEMA_VERSION} – bitte die App aktualisieren.`
    );
  }
  data.entries.forEach((e, i) => validateBackupEntry(e, i));
  if (!Array.isArray(data.tags)) data.tags = [];
  return data as unknown as BackupPayload;
}

// ---------- FTS-Rebuild / -Abgleich ----------

/** FTS-Statements (DELETE+INSERT) für bereits hydratisierte Einträge. */
function ftsStatementsForItems(items: EntryFullItem[]): BatchStatement[] {
  const st: BatchStatement[] = [];
  for (const it of items) {
    st.push(
      ...ftsUpsertStatements({
        entryId: it.id,
        infoForManagement: it.infoForManagement,
        tagLabels: it.tagLabels,
        objections: it.objections.map((o) => ({
          reason: o.reason,
          byWhom: o.byWhom,
        })),
        secretDetails: it.secretDetails,
      })
    );
  }
  return st;
}

/**
 * Baut den FTS-Index vollständig neu auf (leeren + aus allen Einträgen füllen).
 * Aufrufbar für Wartung/nach Schemaänderungen; No-Op ohne FTS5.
 */
export async function rebuildFts(): Promise<void> {
  if (!isFtsAvailable()) return;
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries");
  const items = await hydrateFullEntries(rows);
  const statements: BatchStatement[] = [
    { sql: "DELETE FROM entries_fts", params: [] },
    ...ftsStatementsForItems(items),
  ];
  await db.batch(statements);
}

/**
 * Gleicht den FTS-Index mit dem Datenbestand ab: fehlende Einträge nachtragen,
 * Geisterzeilen entfernen. Läuft beim Start (initSearch) und deckt Migrationen
 * sowie einen erstmals verfügbaren FTS5-Build ab. No-Op bei Übereinstimmung.
 */
export async function reconcileFts(): Promise<void> {
  if (!isFtsAvailable()) return;
  const db = await getDb();
  const entryIds = (
    await db.select<{ id: string }[]>("SELECT id FROM entries")
  ).map((r) => r.id);
  const ftsIds = (
    await db.select<{ entry_id: string }[]>(
      "SELECT entry_id FROM entries_fts"
    )
  ).map((r) => r.entry_id);
  const entrySet = new Set(entryIds);
  const ftsSet = new Set(ftsIds);
  const missing = entryIds.filter((id) => !ftsSet.has(id));
  const ghosts = ftsIds.filter((id) => !entrySet.has(id));
  if (missing.length === 0 && ghosts.length === 0) return;

  const statements: BatchStatement[] = [];
  for (const id of ghosts) {
    statements.push({
      sql: "DELETE FROM entries_fts WHERE entry_id = ?",
      params: [id],
    });
  }
  if (missing.length > 0) {
    const rows = await selectByIdChunks<EntryRow>(
      db,
      missing,
      (ph) => `SELECT * FROM entries WHERE id IN (${ph})`
    );
    const items = await hydrateFullEntries(rows);
    statements.push(...ftsStatementsForItems(items));
  }
  await db.batch(statements);
}
