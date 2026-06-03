import { getDb, isFtsAvailable } from "./client";
import { buildPublicContent, buildSecretContent, buildFtsMatch } from "./ftsContent";
import type {
  TimeEntry,
  TaskTag,
  Objection,
  EntryListItem,
  EntryFilter,
  SearchHit,
  BackupPayload,
  ImportSummary,
} from "../types";

// ---------- Roh-Zeilentypen (snake_case wie in SQLite) ----------

interface EntryRow {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  info_for_management: string;
  secret_details: string;
  had_planned_shift: number;
  shift_compensation_note: string;
  created_at: string;
  updated_at: string;
}

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
    tagIds: [],
    objections: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newObjection(): Objection {
  return { id: generateId(), reason: "", byWhom: "", date: null };
}

function mapEntry(
  r: EntryRow,
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
    secretDetails: r.secret_details,
    hadPlannedShift: r.had_planned_shift === 1,
    shiftCompensationNote: r.shift_compensation_note,
    tagIds: tags.map((t) => t.id),
    tagLabels: tags.map((t) => t.label),
    objections: objs,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function hydrateEntries(rows: EntryRow[]): Promise<EntryListItem[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");

  const tagRows = await db.select<
    { entry_id: string; id: string; label: string }[]
  >(
    `SELECT et.entry_id, t.id, t.label
       FROM entry_tags et JOIN task_tags t ON t.id = et.tag_id
      WHERE et.entry_id IN (${ph})`,
    ids
  );
  const objRows = await db.select<ObjectionRow[]>(
    `SELECT id, entry_id, reason, by_whom, date FROM objections WHERE entry_id IN (${ph})`,
    ids
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

  return rows.map((r) =>
    mapEntry(r, tagsByEntry.get(r.id) || [], objByEntry.get(r.id) || [])
  );
}

// ---------- FTS-Pflege ----------

async function updateFts(entryId: string): Promise<void> {
  if (!isFtsAvailable()) return;
  const db = await getDb();
  const rows = await db.select<
    { info_for_management: string; secret_details: string }[]
  >("SELECT info_for_management, secret_details FROM entries WHERE id = ?", [
    entryId,
  ]);
  await db.execute("DELETE FROM entries_fts WHERE entry_id = ?", [entryId]);
  if (rows.length === 0) return;

  const tagLabels = (
    await db.select<{ label: string }[]>(
      `SELECT t.label FROM entry_tags et JOIN task_tags t ON t.id = et.tag_id WHERE et.entry_id = ?`,
      [entryId]
    )
  ).map((r) => r.label);
  const objs = await db.select<{ reason: string; by_whom: string }[]>(
    "SELECT reason, by_whom FROM objections WHERE entry_id = ?",
    [entryId]
  );

  const publicContent = buildPublicContent({
    infoForManagement: rows[0].info_for_management,
    tagLabels,
    objections: objs.map((o) => ({ reason: o.reason, byWhom: o.by_whom })),
  });
  const secretContent = buildSecretContent(rows[0].secret_details);

  await db.execute(
    "INSERT INTO entries_fts (entry_id, public_content, secret_content) VALUES (?,?,?)",
    [entryId, publicContent, secretContent]
  );
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
  const tag: TaskTag = { id: generateId(), label: label.trim(), archived: false };
  await db.execute("INSERT INTO task_tags (id, label, archived) VALUES (?,?,0)", [
    tag.id,
    tag.label,
  ]);
  return tag;
}

export async function renameTag(id: string, label: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE task_tags SET label = ? WHERE id = ?", [
    label.trim(),
    id,
  ]);
  // FTS-Inhalte aller betroffenen Einträge nachziehen
  const rows = await db.select<{ entry_id: string }[]>(
    "SELECT entry_id FROM entry_tags WHERE tag_id = ?",
    [id]
  );
  for (const r of rows) await updateFts(r.entry_id);
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

export async function getEntry(id: string): Promise<EntryListItem | null> {
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries WHERE id = ?", [
    id,
  ]);
  if (rows.length === 0) return null;
  const items = await hydrateEntries(rows);
  return items[0] ?? null;
}

export async function saveEntry(entry: TimeEntry): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const exists =
    (await db.select<{ id: string }[]>("SELECT id FROM entries WHERE id = ?", [
      entry.id,
    ])).length > 0;

  if (exists) {
    await db.execute(
      `UPDATE entries SET date=?, start_time=?, end_time=?, duration_minutes=?,
         info_for_management=?, secret_details=?, had_planned_shift=?,
         shift_compensation_note=?, updated_at=? WHERE id=?`,
      [
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.infoForManagement,
        entry.secretDetails,
        entry.hadPlannedShift ? 1 : 0,
        entry.shiftCompensationNote,
        now,
        entry.id,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO entries (id, date, start_time, end_time, duration_minutes,
         info_for_management, secret_details, had_planned_shift,
         shift_compensation_note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entry.id,
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.infoForManagement,
        entry.secretDetails,
        entry.hadPlannedShift ? 1 : 0,
        entry.shiftCompensationNote,
        entry.createdAt || now,
        now,
      ]
    );
  }

  // Tags neu setzen
  await db.execute("DELETE FROM entry_tags WHERE entry_id = ?", [entry.id]);
  for (const tagId of entry.tagIds) {
    await db.execute(
      "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)",
      [entry.id, tagId]
    );
  }

  // Widersprüche neu setzen
  await db.execute("DELETE FROM objections WHERE entry_id = ?", [entry.id]);
  for (const o of entry.objections) {
    if (!o.reason.trim() && !o.byWhom.trim()) continue; // leere Zeilen überspringen
    await db.execute(
      "INSERT INTO objections (id, entry_id, reason, by_whom, date) VALUES (?,?,?,?,?)",
      [o.id || generateId(), entry.id, o.reason, o.byWhom, o.date]
    );
  }

  await updateFts(entry.id);
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM objections WHERE entry_id = ?", [id]);
  await db.execute("DELETE FROM entry_tags WHERE entry_id = ?", [id]);
  await db.execute("DELETE FROM entries WHERE id = ?", [id]);
  if (isFtsAvailable())
    await db.execute("DELETE FROM entries_fts WHERE entry_id = ?", [id]);
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

export async function listEntries(
  filter: EntryFilter
): Promise<EntryListItem[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.from) {
    where.push("e.date >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("e.date <= ?");
    params.push(filter.to);
  }
  if (filter.tagIds && filter.tagIds.length > 0) {
    const ph = filter.tagIds.map(() => "?").join(",");
    where.push(
      `EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (${ph}))`
    );
    params.push(...filter.tagIds);
  }

  let hitMap: Map<string, SearchHit> | null = null;
  const term = filter.term?.trim();
  if (term) {
    hitMap = await searchHits(term);
    const ids = [...hitMap.keys()];
    if (ids.length === 0) return [];
    const ph = ids.map(() => "?").join(",");
    where.push(`e.id IN (${ph})`);
    params.push(...ids);
  }

  const sql = `SELECT e.* FROM entries e ${
    where.length ? "WHERE " + where.join(" AND ") : ""
  } ORDER BY e.date DESC, e.start_time DESC`;
  const rows = await db.select<EntryRow[]>(sql, params);
  const items = await hydrateEntries(rows);
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

function toTimeEntry(e: EntryListItem): TimeEntry {
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
  const entries = (await hydrateEntries(rows)).map(toTimeEntry);
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    app: "BR-Zeiten",
    tags,
    entries,
  };
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
  for (const e of payload.entries) {
    const localUpdated = localMap.get(e.id);
    if (localUpdated === undefined) newEntries++;
    else if ((e.updatedAt || "") > localUpdated) conflicts++;
    else unchanged++;
  }
  const localTags = await db.select<{ id: string }[]>(
    "SELECT id FROM task_tags"
  );
  const localTagIds = new Set(localTags.map((t) => t.id));
  let newTags = 0;
  for (const t of payload.tags || []) if (!localTagIds.has(t.id)) newTags++;
  return { newEntries, conflicts, unchanged, newTags };
}

/** Führt den Merge aus: bei UUID-Kollision gewinnt der neuere updated_at. */
export async function applyImport(
  payload: BackupPayload
): Promise<ImportSummary> {
  const summary = await analyzeImport(payload);
  const db = await getDb();

  // 1) Tags mergen (fehlende anlegen, vorhandene nicht überschreiben).
  for (const t of payload.tags || []) {
    await db.execute(
      "INSERT INTO task_tags (id, label, archived) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
      [t.id, t.label, t.archived ? 1 : 0]
    );
  }

  // 2) Einträge mergen.
  const localEntries = await db.select<{ id: string; updated_at: string }[]>(
    "SELECT id, updated_at FROM entries"
  );
  const localMap = new Map(localEntries.map((e) => [e.id, e.updated_at]));

  for (const e of payload.entries) {
    const localUpdated = localMap.get(e.id);
    const isNew = localUpdated === undefined;
    const importerWins = isNew || (e.updatedAt || "") > localUpdated!;
    if (!importerWins) continue; // lokal gleich/älter -> bleibt
    await saveEntry({
      ...e,
      objections: (e.objections || []).map((o) => ({
        ...o,
        id: o.id || generateId(),
      })),
      createdAt: e.createdAt || nowIso(),
    });
  }
  return summary;
}

export function parseBackup(raw: string): BackupPayload {
  const data = JSON.parse(raw) as BackupPayload;
  if (!data || !Array.isArray(data.entries)) {
    throw new Error("Ungültige Backup-Datei: 'entries' fehlt.");
  }
  if (!Array.isArray(data.tags)) data.tags = [];
  return data;
}
