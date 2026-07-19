import { getDb, isFtsAvailable, type Db, type BatchStatement } from "./client";
import {
  buildAppointmentPublicContent,
  buildPublicContent,
  buildSecretContent,
  buildFtsMatch,
} from "./ftsContent";
import { AppError } from "../lib/errors";
import { seriesEndDateFor } from "../lib/appointments";
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
  Appointment,
  AppointmentColor,
  AppointmentFullItem,
  AppointmentListItem,
  AppointmentReminder,
  ReminderFired,
} from "../types";

// ---------- Roh-Zeilentypen (snake_case wie in SQLite) ----------

// Schlanke Eintragszeile OHNE secret_details – für Listen/Kalender/Suche.
interface EntryListRow {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  pause_minutes: number;
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
  "e.id, e.date, e.start_time, e.end_time, e.duration_minutes, e.pause_minutes, " +
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

// Schlanke Terminzeile OHNE secret_details – für Kalender/Agenda/Suche.
interface AppointmentListRow {
  id: string;
  title: string;
  location: string;
  description: string;
  is_all_day: number;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
  is_important: number;
  color: string | null;
  rrule: string | null;
  exdates: string; // JSON-Array (YYYY-MM-DD)
  parent_id: string | null;
  recurrence_anchor: string | null;
  ics_uid: string | null;
  ics_sequence: number;
  created_at: string;
  updated_at: string;
}

// Vollständige Terminzeile inkl. secret_details – für Detail/Backup/FTS.
interface AppointmentRow extends AppointmentListRow {
  secret_details: string;
}

// Explizite Spaltenlisten (alias `a`) nach dem LIST_ENTRY_COLUMNS-Muster:
// Kalender-/Agenda-/Suchpfad lädt secret_details strukturell NICHT.
const LIST_APPT_COLUMNS =
  "a.id, a.title, a.location, a.description, a.is_all_day, a.start_date, " +
  "a.start_time, a.end_date, a.end_time, a.is_important, a.color, a.rrule, " +
  "a.exdates, a.parent_id, a.recurrence_anchor, a.ics_uid, a.ics_sequence, " +
  "a.created_at, a.updated_at";
const FULL_APPT_COLUMNS = LIST_APPT_COLUMNS + ", a.secret_details";

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
    pauseMinutes: 0,
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

/** Leerer Einzeltermin am übergebenen Tag (09:00–10:00), Muster von newEntry. */
export function newAppointment(dateIso: string): Appointment {
  const now = nowIso();
  return {
    id: generateId(),
    title: "",
    location: "",
    description: "",
    secretDetails: "",
    isAllDay: false,
    startDate: dateIso,
    startTime: "09:00",
    endDate: dateIso,
    endTime: "10:00",
    isImportant: false,
    color: null,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceAnchor: null,
    icsUid: null,
    icsSequence: 0,
    tagIds: [],
    reminders: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Neue Erinnerung mit stabiler UUID (siehe AppointmentReminder in types.ts). */
export function newReminder(minutesBefore: number): AppointmentReminder {
  return { id: generateId(), minutesBefore };
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
    pauseMinutes: r.pause_minutes,
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

/**
 * Lädt (entry_id -> Tag-Liste) für die übergebenen Eintrags-IDs. EINZIGE
 * Implementierung des entry_tags/task_tags-Joins für Label-Fetches (Finding
 * 46) -- von loadRelations (Listen/Detail/FTS-Pfad) UND analyzeImport
 * (Konflikt-Vorschau, dort nur als Label-Fallback-Beschreibung gebraucht,
 * daher kein eigener Aufruf von loadRelations mit unnötigem Objections-Mitzug).
 */
async function loadTagsByEntryIds(
  db: Db,
  ids: string[]
): Promise<Map<string, { id: string; label: string }[]>> {
  return loadTagsByOwnerIds(db, ids, "entry_tags", "entry_id");
}

/**
 * Parametrisierte Variante des Tag-Joins für beide n:m-Tabellen (entry_tags
 * und appointment_tags teilen sich task_tags). Tabellen-/Spaltennamen sind
 * Compile-Zeit-Literale, keine Nutzereingaben.
 */
async function loadTagsByOwnerIds(
  db: Db,
  ids: string[],
  joinTable: "entry_tags" | "appointment_tags",
  ownerCol: "entry_id" | "appointment_id"
): Promise<Map<string, { id: string; label: string }[]>> {
  const tagRows = await selectByIdChunks<{
    owner_id: string;
    id: string;
    label: string;
  }>(
    db,
    ids,
    (ph) => `SELECT et.${ownerCol} as owner_id, t.id, t.label
       FROM ${joinTable} et JOIN task_tags t ON t.id = et.tag_id
      WHERE et.${ownerCol} IN (${ph})`
  );
  const tagsByOwner = new Map<string, { id: string; label: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByOwner.get(t.owner_id) || [];
    arr.push({ id: t.id, label: t.label });
    tagsByOwner.set(t.owner_id, arr);
  }
  return tagsByOwner;
}

/** Lädt Schlagwort-Labels und Widersprüche für die übergebenen Eintrags-IDs. */
async function loadRelations(ids: string[]): Promise<{
  tagsByEntry: Map<string, { id: string; label: string }[]>;
  objByEntry: Map<string, Objection[]>;
}> {
  const db = await getDb();
  const tagsByEntry = await loadTagsByEntryIds(db, ids);
  const objRows = await selectByIdChunks<ObjectionRow>(
    db,
    ids,
    (ph) =>
      `SELECT id, entry_id, reason, by_whom, date FROM objections WHERE entry_id IN (${ph})`
  );

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
         pause_minutes=?, info_for_management=?, secret_details=?, had_planned_shift=?,
         shift_compensation_note=?, is_compensation=?, updated_at=? WHERE id=?`,
      params: [
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.pauseMinutes,
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
         pause_minutes, info_for_management, secret_details, had_planned_shift,
         shift_compensation_note, is_compensation, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [
        entry.id,
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.durationMinutes,
        entry.pauseMinutes,
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
  if (!trimmed) throw new AppError("Bitte ein Schlagwort eingeben.");
  // Case-insensitiver Vorab-Check gegen bestehende (auch archivierte) Labels.
  // Seit Migration v1 (src-tauri/src/lib.rs run_migrations) trägt task_tags
  // zusätzlich UNIQUE(label COLLATE NOCASE) als DB-seitiges Sicherheitsnetz;
  // dieser Vorab-Check bleibt bestehen, damit ein Duplikat als klare deutsche
  // Fehlermeldung endet statt als roher UNIQUE-Constraint-Fehler (z. B. bei
  // Doppel-Klick/Doppel-Enter im TagManager).
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM task_tags WHERE label = ? COLLATE NOCASE",
    [trimmed]
  );
  if (existing.length > 0) {
    throw new AppError(`Schlagwort „${trimmed}“ existiert bereits.`);
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
    // Termin-FTS ebenso nachziehen: Tag-Labels sind Teil des public_content
    // der Termine -- sonst findet die Terminsuche den alten Namen dauerhaft,
    // den neuen nie (reconcileFts gleicht nur IDs ab, keinen Inhalt).
    const affectedAppts = await db.select<{ appointment_id: string }[]>(
      "SELECT appointment_id FROM appointment_tags WHERE tag_id = ?",
      [id]
    );
    if (affectedAppts.length > 0) {
      const rows = await selectByIdChunks<AppointmentRow>(
        db,
        affectedAppts.map((a) => a.appointment_id),
        (ph) => `SELECT * FROM appointments WHERE id IN (${ph})`
      );
      const items = await hydrateFullAppointments(rows);
      for (const it of items) {
        const tagLabels = it.tagIds.map((tid, i) =>
          tid === id ? trimmed : it.tagLabels[i]
        );
        statements.push(
          ...apptFtsUpsertStatements({
            appointmentId: it.id,
            title: it.title,
            location: it.location,
            description: it.description,
            tagLabels,
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

/**
 * Gemeinsames Such-Gerüst für Einträge UND Termine (Muster loadTagsByOwnerIds:
 * EINE Semantik, zwei Tabellen): FTS-MATCH über public/secret-Spalten bzw.
 * spaltengebundener LIKE-Fallback. Korrekturen an Escaping oder MATCH-Aufbau
 * landen damit automatisch in beiden Suchpfaden.
 */
async function searchHitsFor(
  term: string,
  cfg: {
    ftsTable: "entries_fts" | "appointments_fts";
    idColumn: "entry_id" | "appointment_id";
    /** LIKE-Fallback öffentliche Spalten; jedes ? erhält den LIKE-Term. */
    likePublicSql: string;
    likePublicParamCount: number;
    likeSecretSql: string;
  }
): Promise<Map<string, SearchHit>> {
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
      const r = await db.select<{ id: string }[]>(
        `SELECT ${cfg.idColumn} AS id FROM ${cfg.ftsTable} WHERE ${cfg.ftsTable} MATCH ?`,
        [pub]
      );
      for (const x of r) mark(x.id, "hasPublicHit");
    }
    if (sec) {
      const r = await db.select<{ id: string }[]>(
        `SELECT ${cfg.idColumn} AS id FROM ${cfg.ftsTable} WHERE ${cfg.ftsTable} MATCH ?`,
        [sec]
      );
      for (const x of r) mark(x.id, "hasSecretHit");
    }
  } else {
    // Kompletter Fallback NUR falls FTS5 im Build fehlt – getrennte Spalten-Logik via LIKE.
    const like = `%${term.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const pub = await db.select<{ id: string }[]>(
      cfg.likePublicSql,
      Array<string>(cfg.likePublicParamCount).fill(like)
    );
    for (const x of pub) mark(x.id, "hasPublicHit");
    const sec = await db.select<{ id: string }[]>(cfg.likeSecretSql, [like]);
    for (const x of sec) mark(x.id, "hasSecretHit");
  }
  return map;
}

async function searchHits(term: string): Promise<Map<string, SearchHit>> {
  return searchHitsFor(term, {
    ftsTable: "entries_fts",
    idColumn: "entry_id",
    likePublicSql: `SELECT DISTINCT e.id FROM entries e
        WHERE e.info_for_management LIKE ? ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM entry_tags et JOIN task_tags t ON t.id=et.tag_id
                       WHERE et.entry_id=e.id AND t.label LIKE ? ESCAPE '\\')
           OR EXISTS (SELECT 1 FROM objections o WHERE o.entry_id=e.id
                       AND (o.reason LIKE ? ESCAPE '\\' OR o.by_whom LIKE ? ESCAPE '\\'))`,
    likePublicParamCount: 4,
    likeSecretSql: "SELECT id FROM entries WHERE secret_details LIKE ? ESCAPE '\\'",
  });
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

/**
 * Tagessummen ALLER Aktivität (BR-Zeit UND Freizeitausgleich zusammen) --
 * bewusst ungefiltert, weil die Kalender-Tages-Marker (AppointmentMonthGrid) jede
 * Aktivität an einem Tag zeigen sollen, unabhängig von ihrer Art.
 */
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

/**
 * BR-Arbeitszeit- und Freizeitausgleich-Minuten GETRENNT für einen Zeitraum
 * (Finding B2/Summen-Konsistenz). Die Kalender-Monatssumme (AppointmentMonthGrid) und
 * die "Diese Woche"-Summe (QuickEntryView) zählten Ausgleichs-Minuten bisher
 * über daySums MIT, während die Auswertung (getStatsSummary) sie ausschließt
 * -- unterschiedliche Zahlen für dieselbe Frage "wie viel BR-Zeit". Eine
 * eigene, schlanke Abfrage statt daySums mit einem Filter zu überladen: die
 * Tages-Marker im Kalender sollen weiterhin ALLE Aktivität zeigen (s. o.),
 * nur die Kopf-/Wochensumme muss zur Auswertung passen. `work` fließt in die
 * Summe ein, `compensation` wird -- wie in EntryList/PrintReportPanel bereits
 * üblich -- separat ausgewiesen statt stillschweigend zu verschwinden.
 */
export async function getWorkAndCompensationMinutes(
  from: string,
  to: string
): Promise<{ work: number; compensation: number }> {
  const db = await getDb();
  const rows = await db.select<
    { work: number | null; compensation: number | null }[]
  >(
    `SELECT
       SUM(CASE WHEN is_compensation = 0 THEN duration_minutes ELSE 0 END) as work,
       SUM(CASE WHEN is_compensation = 1 THEN duration_minutes ELSE 0 END) as compensation
     FROM entries WHERE date >= ? AND date <= ?`,
    [from, to]
  );
  return {
    work: rows[0]?.work ?? 0,
    compensation: rows[0]?.compensation ?? 0,
  };
}

/**
 * Datum des jüngsten Eintrags (YYYY-MM-DD) oder null ohne Einträge. Grundlage
 * für die lokale Erinnerung bei fehlender Erfassung (Finding 31) -- eine
 * einfache SELECT MAX(date)-Abfrage, kein Cloud-/Notification-Dienst.
 */
export async function getLastEntryDate(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ maxDate: string | null }[]>(
    "SELECT MAX(date) as maxDate FROM entries"
  );
  return rows[0]?.maxDate ?? null;
}

// ---------- Termine ----------

/** Defensives Parsen der exdates-JSON-Spalte (kaputte Werte -> leeres Array). */
function parseExdates(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function mapListAppointment(
  r: AppointmentListRow,
  tags: { id: string; label: string }[],
  reminders: AppointmentReminder[]
): AppointmentListItem {
  return {
    id: r.id,
    title: r.title,
    location: r.location,
    description: r.description,
    isAllDay: r.is_all_day === 1,
    startDate: r.start_date,
    startTime: r.start_time,
    endDate: r.end_date,
    endTime: r.end_time,
    isImportant: r.is_important === 1,
    color: (r.color as AppointmentColor | null) ?? null,
    rrule: r.rrule,
    exdates: parseExdates(r.exdates),
    parentId: r.parent_id,
    recurrenceAnchor: r.recurrence_anchor,
    icsUid: r.ics_uid,
    icsSequence: r.ics_sequence,
    tagIds: tags.map((t) => t.id),
    tagLabels: tags.map((t) => t.label),
    reminders,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFullAppointment(
  r: AppointmentRow,
  tags: { id: string; label: string }[],
  reminders: AppointmentReminder[]
): AppointmentFullItem {
  return {
    ...mapListAppointment(r, tags, reminders),
    secretDetails: r.secret_details,
  };
}

/** Lädt Schlagwörter + Erinnerungen für die übergebenen Termin-IDs. */
async function loadApptRelations(ids: string[]): Promise<{
  tagsByAppt: Map<string, { id: string; label: string }[]>;
  remindersByAppt: Map<string, AppointmentReminder[]>;
}> {
  const db = await getDb();
  const tagsByAppt = await loadTagsByOwnerIds(
    db,
    ids,
    "appointment_tags",
    "appointment_id"
  );
  const remRows = await selectByIdChunks<{
    id: string;
    appointment_id: string;
    minutes_before: number;
  }>(
    db,
    ids,
    (ph) => `SELECT id, appointment_id, minutes_before
       FROM appointment_reminders WHERE appointment_id IN (${ph})
      ORDER BY minutes_before`
  );
  const remindersByAppt = new Map<string, AppointmentReminder[]>();
  for (const r of remRows) {
    const arr = remindersByAppt.get(r.appointment_id) || [];
    arr.push({ id: r.id, minutesBefore: r.minutes_before });
    remindersByAppt.set(r.appointment_id, arr);
  }
  return { tagsByAppt, remindersByAppt };
}

async function hydrateListAppointments(
  rows: AppointmentListRow[]
): Promise<AppointmentListItem[]> {
  if (rows.length === 0) return [];
  const { tagsByAppt, remindersByAppt } = await loadApptRelations(
    rows.map((r) => r.id)
  );
  return rows.map((r) =>
    mapListAppointment(r, tagsByAppt.get(r.id) || [], remindersByAppt.get(r.id) || [])
  );
}

async function hydrateFullAppointments(
  rows: AppointmentRow[]
): Promise<AppointmentFullItem[]> {
  if (rows.length === 0) return [];
  const { tagsByAppt, remindersByAppt } = await loadApptRelations(
    rows.map((r) => r.id)
  );
  return rows.map((r) =>
    mapFullAppointment(r, tagsByAppt.get(r.id) || [], remindersByAppt.get(r.id) || [])
  );
}

/** DELETE+INSERT der FTS-Zeile eines Termins (leer, falls FTS5 fehlt). */
function apptFtsUpsertStatements(args: {
  appointmentId: string;
  title: string;
  location: string;
  description: string;
  tagLabels: string[];
  secretDetails: string;
}): BatchStatement[] {
  if (!isFtsAvailable()) return [];
  const publicContent = buildAppointmentPublicContent(args);
  const secretContent = buildSecretContent(args.secretDetails);
  return [
    {
      sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
      params: [args.appointmentId],
    },
    {
      sql: "INSERT INTO appointments_fts (appointment_id, public_content, secret_content) VALUES (?,?,?)",
      params: [args.appointmentId, publicContent, secretContent],
    },
  ];
}

/**
 * Baut alle Statements, um EINEN Termin zu schreiben (Terminzeile, Schlagwort-
 * Zuordnungen, Erinnerungen, FTS) – atomare Einheit für db_batch, Muster von
 * entryWriteStatements.
 *
 * Besonderheiten:
 *  - Overrides (parentId gesetzt) erben Schlagwörter + Erinnerungen des
 *    Masters -- für sie werden KEINE appointment_tags/-reminders geschrieben.
 *  - Erinnerungen werden DIFF-basiert geschrieben (nur entfernte löschen,
 *    geänderte aktualisieren, neue einfügen): ein pauschales DELETE+INSERT
 *    würde via ON DELETE CASCADE das reminder_fired-Protokoll mitreißen und
 *    bereits gezeigte Erinnerungen nach jedem Speichern erneut feuern lassen.
 *    `existingReminders` ist der aktuelle DB-Stand (leer bei Neuanlage).
 */
function appointmentWriteStatements(args: {
  appt: Appointment;
  exists: boolean;
  updatedAt: string;
  createdAtDefault: string;
  tagLabelById: Map<string, string>;
  existingReminders: AppointmentReminder[];
}): BatchStatement[] {
  const { appt, exists, updatedAt, createdAtDefault, tagLabelById } = args;
  const st: BatchStatement[] = [];
  const isOverride = appt.parentId !== null;
  const validTagIds = isOverride
    ? []
    : appt.tagIds.filter((id) => tagLabelById.has(id));
  const exdatesJson = JSON.stringify(appt.exdates ?? []);
  // Cache für den Lade-Hot-Path (listAppointmentsRange, s. dortigen Kommentar):
  // letzter berührbarer Tag der Serie, NUR für Serien-Master berechnet --
  // Overrides und Einzeltermine tragen bewusst NULL. `null` heißt auch bei
  // Mastern "endlos oder unbekannt" (s. seriesEndDateFor).
  const seriesEnd =
    appt.parentId === null && appt.rrule !== null ? seriesEndDateFor(appt) : null;

  if (exists) {
    st.push({
      sql: `UPDATE appointments SET title=?, location=?, description=?, secret_details=?,
         is_all_day=?, start_date=?, start_time=?, end_date=?, end_time=?, is_important=?,
         color=?, rrule=?, exdates=?, parent_id=?, recurrence_anchor=?, ics_uid=?,
         ics_sequence=?, series_end_date=?, updated_at=? WHERE id=?`,
      params: [
        appt.title,
        appt.location,
        appt.description,
        appt.secretDetails,
        appt.isAllDay ? 1 : 0,
        appt.startDate,
        appt.startTime,
        appt.endDate,
        appt.endTime,
        appt.isImportant ? 1 : 0,
        appt.color,
        appt.rrule,
        exdatesJson,
        appt.parentId,
        appt.recurrenceAnchor,
        appt.icsUid,
        appt.icsSequence,
        seriesEnd,
        updatedAt,
        appt.id,
      ],
    });
  } else {
    st.push({
      sql: `INSERT INTO appointments (id, title, location, description, secret_details,
         is_all_day, start_date, start_time, end_date, end_time, is_important, color,
         rrule, exdates, parent_id, recurrence_anchor, ics_uid, ics_sequence,
         series_end_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [
        appt.id,
        appt.title,
        appt.location,
        appt.description,
        appt.secretDetails,
        appt.isAllDay ? 1 : 0,
        appt.startDate,
        appt.startTime,
        appt.endDate,
        appt.endTime,
        appt.isImportant ? 1 : 0,
        appt.color,
        appt.rrule,
        exdatesJson,
        appt.parentId,
        appt.recurrenceAnchor,
        appt.icsUid,
        appt.icsSequence,
        seriesEnd,
        appt.createdAt || createdAtDefault,
        updatedAt,
      ],
    });
  }

  if (!isOverride) {
    st.push({
      sql: "DELETE FROM appointment_tags WHERE appointment_id = ?",
      params: [appt.id],
    });
    for (const tagId of validTagIds) {
      st.push({
        sql: "INSERT OR IGNORE INTO appointment_tags (appointment_id, tag_id) VALUES (?,?)",
        params: [appt.id, tagId],
      });
    }

    // Erinnerungs-DIFF (s. Funktionskommentar).
    const wanted = new Map(appt.reminders.map((r) => [r.id, r.minutesBefore]));
    for (const ex of args.existingReminders) {
      if (!wanted.has(ex.id)) {
        st.push({
          sql: "DELETE FROM appointment_reminders WHERE id = ?",
          params: [ex.id],
        });
      } else if (wanted.get(ex.id) !== ex.minutesBefore) {
        st.push({
          sql: "UPDATE appointment_reminders SET minutes_before = ? WHERE id = ?",
          params: [wanted.get(ex.id), ex.id],
        });
      }
    }
    const existingIds = new Set(args.existingReminders.map((r) => r.id));
    for (const r of appt.reminders) {
      if (!existingIds.has(r.id)) {
        st.push({
          sql: "INSERT OR IGNORE INTO appointment_reminders (id, appointment_id, minutes_before) VALUES (?,?,?)",
          params: [r.id, appt.id, r.minutesBefore],
        });
      }
    }
  }

  st.push(
    ...apptFtsUpsertStatements({
      appointmentId: appt.id,
      title: appt.title,
      location: appt.location,
      description: appt.description,
      tagLabels: validTagIds.map((id) => tagLabelById.get(id)!),
      secretDetails: appt.secretDetails,
    })
  );
  return st;
}

export async function getAppointment(
  id: string
): Promise<AppointmentFullItem | null> {
  const db = await getDb();
  const rows = await db.select<AppointmentRow[]>(
    `SELECT ${FULL_APPT_COLUMNS} FROM appointments a WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return null;
  const items = await hydrateFullAppointments(rows);
  return items[0] ?? null;
}

/**
 * Aktueller Erinnerungs-Bestand eines Termins fürs DIFF-Schreiben
 * (appointmentWriteStatements) -- EINE Implementierung für saveAppointment,
 * splitSeries und truncateSeries: die stabilen Reminder-IDs schützen das
 * reminder_fired-Protokoll, dieser Ladepfad darf nicht auseinanderdriften.
 */
async function loadExistingReminders(
  db: Db,
  appointmentId: string
): Promise<AppointmentReminder[]> {
  const rows = await db.select<{ id: string; minutes_before: number }[]>(
    "SELECT id, minutes_before FROM appointment_reminders WHERE appointment_id = ?",
    [appointmentId]
  );
  return rows.map((r) => ({ id: r.id, minutesBefore: r.minutes_before }));
}

/**
 * Speichert einen Termin (Master, Einzeltermin oder Override) samt Schlag-
 * wörtern, Erinnerungen und FTS-Index ATOMAR. `updatedAtOverride` erhält beim
 * Import den Original-Zeitstempel (Last-Writer-Wins, wie saveEntry).
 */
export async function saveAppointment(
  appt: Appointment,
  updatedAtOverride?: string
): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const exists =
    (
      await db.select<{ id: string }[]>(
        "SELECT id FROM appointments WHERE id = ?",
        [appt.id]
      )
    ).length > 0;
  const tagLabelById = await loadTagLabels(db, appt.tagIds);
  const statements = appointmentWriteStatements({
    appt,
    exists,
    updatedAt: updatedAtOverride ?? now,
    createdAtDefault: now,
    tagLabelById,
    existingReminders: exists ? await loadExistingReminders(db, appt.id) : [],
  });
  await db.batch(statements);
}

/**
 * Löscht einen Termin. Bei einem Serien-Master fallen die Overrides per
 * ON DELETE CASCADE mit -- deren FTS-Zeilen (kein FK-Bezug) werden hier
 * explizit mit abgeräumt (Muster von deleteEntry: explizite DELETEs als klare
 * Absicht, Kaskade als zweite Verteidigungslinie).
 */
export async function deleteAppointment(id: string): Promise<void> {
  const db = await getDb();
  const overrideIds = (
    await db.select<{ id: string }[]>(
      "SELECT id FROM appointments WHERE parent_id = ?",
      [id]
    )
  ).map((r) => r.id);
  await db.batch(appointmentDeleteStatements(id, overrideIds));
}

/**
 * Die vollständige Lösch-Kaskade eines Termins (Feuer-Protokoll, Erinnerungen,
 * Schlagwort-Zuordnungen, eigene Overrides, Terminzeile, FTS) als Statement-
 * Baustein -- EINE Quelle für deleteAppointment und den Ersetzen-Pfad des
 * ICS-Imports; eine neue Kind-Tabelle muss nur hier ergänzt werden.
 */
function appointmentDeleteStatements(
  id: string,
  overrideIds: string[]
): BatchStatement[] {
  const statements: BatchStatement[] = [
    { sql: "DELETE FROM reminder_fired WHERE appointment_id = ?", params: [id] },
    {
      sql: "DELETE FROM appointment_reminders WHERE appointment_id = ?",
      params: [id],
    },
    { sql: "DELETE FROM appointment_tags WHERE appointment_id = ?", params: [id] },
    { sql: "DELETE FROM appointments WHERE parent_id = ?", params: [id] },
    { sql: "DELETE FROM appointments WHERE id = ?", params: [id] },
  ];
  if (isFtsAvailable()) {
    for (const fid of [id, ...overrideIds]) {
      statements.push({
        sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
        params: [fid],
      });
    }
  }
  return statements;
}

/**
 * Lädt alle Termine, die für ein Anzeigefenster [from, to] relevant sind, als
 * schlanke Listen-Items (OHNE secretDetails). Drei Teilmengen:
 *  1. Einzeltermine, die das Fenster überlappen (mehrtägige inklusive),
 *  2. Serien-Master mit start_date <= to UND (series_end_date IS NULL ODER
 *     series_end_date >= from) -- ob eine Instanz TATSÄCHLICH ins Fenster
 *     fällt, entscheidet weiterhin erst die RRULE-Expansion in
 *     lib/appointments.ts (UNTIL/COUNT lassen sich SQL-seitig nicht
 *     auswerten). Der Cache `series_end_date` (Issue #4) ist ein reiner
 *     Hot-Path-Filter: er lässt NUR Master, deren Serie nachweislich VOR dem
 *     Fenster geendet hat, den Ladepfad verlassen -- endlose/unbekannte
 *     Serien (NULL) bleiben stets drin. Der EXISTS-Zweig für vorgezogene
 *     Overrides bleibt bewusst UNGEFILTERT: sonst verschwände eine Instanz,
 *     die aus einer bereits beendeten Serie heraus in das Fenster verschoben
 *     wurde.
 *  3. ALLE Overrides der geladenen Master (ein Override kann von außerhalb
 *     ins Fenster verschoben worden sein und umgekehrt).
 */
export async function listAppointmentsRange(
  from: string,
  to: string
): Promise<AppointmentListItem[]> {
  const db = await getDb();
  // Die EXISTS-Bedingungen fangen Overrides, deren EIGENE Daten im Fenster
  // liegen, obwohl der Master es nicht berührt (Instanz vor den Serienstart
  // verlegt; Master ohne Regel nach "Serie -> Nie"). Ohne sie wäre so ein
  // Termin nirgends sichtbar -- auch nicht im Erinnerungs-Snapshot.
  const singles = await db.select<AppointmentListRow[]>(
    `SELECT ${LIST_APPT_COLUMNS} FROM appointments a
      WHERE a.rrule IS NULL AND a.parent_id IS NULL
        AND (a.start_date <= ? AND a.end_date >= ?
             OR EXISTS (SELECT 1 FROM appointments o WHERE o.parent_id = a.id
                          AND o.start_date <= ? AND o.end_date >= ?))`,
    [to, from, to, from]
  );
  const masters = await db.select<AppointmentListRow[]>(
    `SELECT ${LIST_APPT_COLUMNS} FROM appointments a
      WHERE a.rrule IS NOT NULL AND a.parent_id IS NULL
        AND ((a.start_date <= ? AND (a.series_end_date IS NULL OR a.series_end_date >= ?))
             OR EXISTS (SELECT 1 FROM appointments o WHERE o.parent_id = a.id
                          AND o.start_date <= ? AND o.end_date >= ?))`,
    [to, from, to, from]
  );
  // Overrides für ALLE geladenen Master (auch regel-lose, s. expandOccurrences).
  const parentIds = [...singles, ...masters].map((m) => m.id);
  const overrides =
    parentIds.length === 0
      ? []
      : await selectByIdChunks<AppointmentListRow>(
          db,
          parentIds,
          (ph) =>
            `SELECT ${LIST_APPT_COLUMNS} FROM appointments a WHERE a.parent_id IN (${ph})`
        );
  return hydrateListAppointments([...singles, ...masters, ...overrides]);
}

/**
 * Löscht EINE Instanz einer Serie ("nur dieser Termin"): Anker in exdates des
 * Masters aufnehmen; ein eventueller Override dieser Instanz wird mit
 * entfernt (die Instanz soll ganz verschwinden, nicht auf den generierten
 * Stand zurückfallen).
 */
export async function deleteOccurrence(
  masterId: string,
  anchor: string
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ exdates: string }[]>(
    "SELECT exdates FROM appointments WHERE id = ?",
    [masterId]
  );
  if (rows.length === 0) return;
  const exdates = parseExdates(rows[0].exdates);
  if (!exdates.includes(anchor)) exdates.push(anchor);
  exdates.sort();
  const override = await db.select<{ id: string }[]>(
    "SELECT id FROM appointments WHERE parent_id = ? AND recurrence_anchor = ?",
    [masterId, anchor]
  );
  const statements: BatchStatement[] = [
    {
      sql: "UPDATE appointments SET exdates = ?, updated_at = ? WHERE id = ?",
      params: [JSON.stringify(exdates), nowIso(), masterId],
    },
  ];
  for (const o of override) {
    statements.push({
      sql: "DELETE FROM appointments WHERE id = ?",
      params: [o.id],
    });
    if (isFtsAvailable()) {
      statements.push({
        sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
        params: [o.id],
      });
    }
  }
  await db.batch(statements);
}

/**
 * "Diesen und alle folgenden bearbeiten" (UNTIL-Split) in EINER Transaktion:
 * der Aufrufer hat den alten Master bereits mit UNTIL (Vortag des Ankers)
 * versehen und die neue Serie ab dem Anker aufgebaut (inkl. aufgeteilter
 * exdates); hier werden beide geschrieben und die Overrides ab dem Anker auf
 * die neue Serie umgehängt.
 */
export async function splitSeries(args: {
  master: Appointment;
  newSeries: Appointment;
  anchor: string;
}): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const tagLabelById = await loadTagLabels(db, [
    ...args.master.tagIds,
    ...args.newSeries.tagIds,
  ]);
  const statements: BatchStatement[] = [
    ...appointmentWriteStatements({
      appt: args.master,
      exists: true,
      updatedAt: now,
      createdAtDefault: now,
      tagLabelById,
      existingReminders: await loadExistingReminders(db, args.master.id),
    }),
    ...appointmentWriteStatements({
      appt: args.newSeries,
      exists: false,
      updatedAt: now,
      createdAtDefault: now,
      tagLabelById,
      existingReminders: [],
    }),
    {
      sql: `UPDATE appointments SET parent_id = ?
             WHERE parent_id = ? AND recurrence_anchor >= ?`,
      params: [args.newSeries.id, args.master.id, args.anchor],
    },
  ];
  // Feuer-Protokoll ab dem Anker auf die neue Serie umschreiben: der Split
  // vergibt neue Termin- UND Reminder-IDs -- ohne Migration kennt der
  // firedKey (appointmentId|reminderId|anchor) bereits gezeigte Erinnerungen
  // künftiger Instanzen nicht mehr und sie feuern erneut. Das Mapping alte ->
  // neue Reminder-ID läuft über die parallel aufgebauten reminders-Arrays
  // (buildSplitDraft erzeugt sie 1:1 in gleicher Reihenfolge). Muss NACH dem
  // newSeries-Write stehen (FK reminder_id -> appointment_reminders).
  if (args.master.reminders.length === args.newSeries.reminders.length) {
    for (let i = 0; i < args.master.reminders.length; i++) {
      const oldRem = args.master.reminders[i];
      const newRem = args.newSeries.reminders[i];
      if (oldRem.minutesBefore !== newRem.minutesBefore) continue;
      statements.push({
        sql: `UPDATE reminder_fired SET appointment_id = ?, reminder_id = ?
               WHERE appointment_id = ? AND reminder_id = ? AND occurrence_anchor >= ?`,
        params: [
          args.newSeries.id,
          newRem.id,
          args.master.id,
          oldRem.id,
          args.anchor,
        ],
      });
    }
  }
  await db.batch(statements);
}

/**
 * "Diesen und alle folgenden LÖSCHEN": der Aufrufer hat den Master bereits
 * mit UNTIL (Vortag des Ankers) versehen und die exdates auf < Anker
 * gefiltert; hier wird er geschrieben und die Overrides ab dem Anker werden
 * mitsamt ihrer FTS-Zeilen entfernt -- in EINER Transaktion.
 */
export async function truncateSeries(args: {
  master: Appointment;
  anchor: string;
}): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const tagLabelById = await loadTagLabels(db, args.master.tagIds);
  const overrideRows = await db.select<{ id: string }[]>(
    "SELECT id FROM appointments WHERE parent_id = ? AND recurrence_anchor >= ?",
    [args.master.id, args.anchor]
  );
  const statements: BatchStatement[] = [
    ...appointmentWriteStatements({
      appt: args.master,
      exists: true,
      updatedAt: now,
      createdAtDefault: now,
      tagLabelById,
      existingReminders: await loadExistingReminders(db, args.master.id),
    }),
  ];
  for (const o of overrideRows) {
    statements.push({
      sql: "DELETE FROM appointments WHERE id = ?",
      params: [o.id],
    });
    if (isFtsAvailable()) {
      statements.push({
        sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
        params: [o.id],
      });
    }
  }
  await db.batch(statements);
}

/**
 * Volltextsuche über Termine (Muster searchHits: spaltengebundene Treffer-
 * Herkunft public/secret, LIKE-Fallback ohne FTS5). Liefert schlanke
 * Listen-Items (OHNE secretDetails) mit gesetztem `search`, sortiert nach
 * Startdatum. Overrides zählen als eigene Treffer (sie tragen eigene Texte).
 */
export async function searchAppointments(
  term: string
): Promise<AppointmentListItem[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const db = await getDb();
  const map = await searchHitsFor(trimmed, {
    ftsTable: "appointments_fts",
    idColumn: "appointment_id",
    likePublicSql: `SELECT DISTINCT a.id FROM appointments a
        WHERE a.title LIKE ? ESCAPE '\\'
           OR a.location LIKE ? ESCAPE '\\'
           OR a.description LIKE ? ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM appointment_tags at JOIN task_tags t ON t.id=at.tag_id
                       WHERE at.appointment_id=a.id AND t.label LIKE ? ESCAPE '\\')`,
    likePublicParamCount: 4,
    likeSecretSql:
      "SELECT id FROM appointments WHERE secret_details LIKE ? ESCAPE '\\'",
  });

  const ids = [...map.keys()];
  if (ids.length === 0) return [];
  const rows = await selectByIdChunks<AppointmentListRow>(
    db,
    ids,
    (ph) => `SELECT ${LIST_APPT_COLUMNS} FROM appointments a WHERE a.id IN (${ph})`
  );
  rows.sort((a, b) =>
    a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0
  );
  const items = await hydrateListAppointments(rows);
  for (const it of items) it.search = map.get(it.id);
  return items;
}

/**
 * ALLE Termine voll geladen (inkl. secretDetails/tagLabels) -- für den
 * ICS-Export. Master/Einzeltermine vor Overrides (stabile Export-Ordnung).
 */
export async function listAllAppointmentsFull(): Promise<AppointmentFullItem[]> {
  const db = await getDb();
  const rows = await db.select<AppointmentRow[]>(
    "SELECT * FROM appointments ORDER BY (parent_id IS NOT NULL), start_date"
  );
  return hydrateFullAppointments(rows);
}

/**
 * (ics_uid -> lokale Master-Zeile) für die Import-Dedupe (UID+SEQUENCE).
 * Nur Master/Einzeltermine -- Overrides tragen keine eigene UID.
 */
export async function listAppointmentsByIcsUid(
  uids: string[]
): Promise<Map<string, { id: string; icsSequence: number }>> {
  const map = new Map<string, { id: string; icsSequence: number }>();
  if (uids.length === 0) return map;
  const db = await getDb();
  const rows = await selectByIdChunks<{
    id: string;
    ics_uid: string;
    ics_sequence: number;
  }>(
    db,
    uids,
    (ph) => `SELECT id, ics_uid, ics_sequence FROM appointments
      WHERE parent_id IS NULL AND ics_uid IN (${ph})`
  );
  for (const r of rows) map.set(r.ics_uid, { id: r.id, icsSequence: r.ics_sequence });
  return map;
}

/**
 * (Termin-ID -> lokale Master-Zeile) für den Reimport eigener Exporte: deren
 * UID (`<id>@br-log.local`) kodiert die lokale ID, die Zeile selbst hat
 * ics_uid = NULL und ist über listAppointmentsByIcsUid nicht auffindbar.
 */
export async function listAppointmentMastersByIds(
  ids: string[]
): Promise<Map<string, { id: string; icsSequence: number }>> {
  const map = new Map<string, { id: string; icsSequence: number }>();
  if (ids.length === 0) return map;
  const db = await getDb();
  const rows = await selectByIdChunks<{ id: string; ics_sequence: number }>(
    db,
    ids,
    (ph) => `SELECT id, ics_sequence FROM appointments
      WHERE parent_id IS NULL AND id IN (${ph})`
  );
  for (const r of rows) map.set(r.id, { id: r.id, icsSequence: r.ics_sequence });
  return map;
}

/**
 * (Master-ID -> vorhandene Override-Anker) für die Einzel-Übernahme von
 * Serien-Ausnahmen beim ICS-Import (belegte Anker werden nie überschrieben).
 */
export async function listOverrideAnchors(
  masterIds: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (masterIds.length === 0) return map;
  const db = await getDb();
  const rows = await selectByIdChunks<{
    parent_id: string;
    recurrence_anchor: string | null;
  }>(
    db,
    masterIds,
    (ph) => `SELECT parent_id, recurrence_anchor FROM appointments
      WHERE parent_id IN (${ph})`
  );
  for (const r of rows) {
    if (!r.recurrence_anchor) continue;
    const set = map.get(r.parent_id) ?? new Set<string>();
    set.add(r.recurrence_anchor);
    map.set(r.parent_id, set);
  }
  return map;
}

/**
 * Wendet einen ICS-Import ATOMAR an: ersetzte Bestände (UID-Match mit
 * neuerer SEQUENCE -- die Serie wird KOMPLETT ersetzt, inkl. Overrides und
 * Feuer-Protokoll) löschen, dann alle importierten Termine frisch einfügen
 * (Master vor Overrides, Reihenfolge liefert der Aufrufer).
 */
export async function applyIcsAppointments(
  appointments: Appointment[],
  replaceIds: string[]
): Promise<void> {
  if (appointments.length === 0 && replaceIds.length === 0) return;
  const db = await getDb();
  const now = nowIso();
  const tagLabelById = await loadTagLabels(
    db,
    appointments.flatMap((a) => a.tagIds)
  );
  const replacedOverrideIds =
    replaceIds.length === 0
      ? []
      : (
          await selectByIdChunks<{ id: string }>(
            db,
            replaceIds,
            (ph) => `SELECT id FROM appointments WHERE parent_id IN (${ph})`
          )
        ).map((r) => r.id);

  const statements: BatchStatement[] = [];
  // Die geteilte Lösch-Kaskade erwartet die Override-IDs je Master; die
  // Sammel-Query oben liefert sie ungruppiert -- fürs FTS-Aufräumen reicht es,
  // sie komplett dem ersten Master mitzugeben (DELETEs sind idempotent).
  for (const [i, id] of replaceIds.entries()) {
    statements.push(
      ...appointmentDeleteStatements(id, i === 0 ? replacedOverrideIds : [])
    );
  }
  for (const a of appointments) {
    statements.push(
      ...appointmentWriteStatements({
        appt: a,
        exists: false,
        updatedAt: a.updatedAt || now,
        createdAtDefault: now,
        tagLabelById,
        existingReminders: [],
      })
    );
  }
  await db.batch(statements);
}

// ---------- Erinnerungs-Protokoll (reminder_fired) ----------

/** Markiert eine Erinnerung als gefeuert (idempotent via INSERT OR IGNORE). */
export async function markReminderFired(f: ReminderFired): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO reminder_fired
       (appointment_id, reminder_id, occurrence_anchor, fired_at)
     VALUES (?,?,?,?)`,
    [f.appointmentId, f.reminderId, f.occurrenceAnchor, f.firedAt]
  );
}

/** Alle Feuer-Markierungen ab dem übergebenen Anker (für das Scheduler-Set). */
export async function listFiredReminders(
  fromAnchor: string
): Promise<ReminderFired[]> {
  const db = await getDb();
  const rows = await db.select<
    {
      appointment_id: string;
      reminder_id: string;
      occurrence_anchor: string;
      fired_at: string;
    }[]
  >(
    "SELECT appointment_id, reminder_id, occurrence_anchor, fired_at FROM reminder_fired WHERE occurrence_anchor >= ?",
    [fromAnchor]
  );
  return rows.map((r) => ({
    appointmentId: r.appointment_id,
    reminderId: r.reminder_id,
    occurrenceAnchor: r.occurrence_anchor,
    firedAt: r.fired_at,
  }));
}

/** Räumt alte Feuer-Markierungen auf (Best-effort beim Start, ~90 Tage). */
export async function cleanupFiredBefore(anchorIso: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM reminder_fired WHERE occurrence_anchor < ?", [
    anchorIso,
  ]);
}

// ---------- Backup / Import ----------

function toTimeEntry(e: EntryFullItem): TimeEntry {
  return {
    id: e.id,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    durationMinutes: e.durationMinutes,
    pauseMinutes: e.pauseMinutes,
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

/** Appointment (Backup-Form) aus einem voll geladenen Termin (ohne tagLabels). */
function toAppointment(a: AppointmentFullItem): Appointment {
  return {
    id: a.id,
    title: a.title,
    location: a.location,
    description: a.description,
    secretDetails: a.secretDetails,
    isAllDay: a.isAllDay,
    startDate: a.startDate,
    startTime: a.startTime,
    endDate: a.endDate,
    endTime: a.endTime,
    isImportant: a.isImportant,
    color: a.color,
    rrule: a.rrule,
    exdates: a.exdates,
    parentId: a.parentId,
    recurrenceAnchor: a.recurrenceAnchor,
    icsUid: a.icsUid,
    icsSequence: a.icsSequence,
    tagIds: a.tagIds,
    reminders: a.reminders,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function getAllForBackup(): Promise<BackupPayload> {
  const db = await getDb();
  const tags = await listTags(true);
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries ORDER BY date");
  const entries = (await hydrateFullEntries(rows)).map(toTimeEntry);
  // Master vor Overrides (garantiert listAllAppointmentsFull): applyImport
  // schreibt in Dateireihenfolge, Overrides brauchen ihren Master (FK) bereits.
  const appointments = (await listAllAppointmentsFull()).map(toAppointment);
  const reminderFired = await listFiredReminders("0000-01-01");
  return {
    // Version 2 seit dem Terminkalender: Termine sind ein eigener Datenbestand
    // -- ein älterer App-Stand würde das Feld stillschweigend ignorieren und
    // beim Restore alle Termine verlieren. Die Versionsanhebung sorgt dafür,
    // dass er stattdessen die klare "bitte App aktualisieren"-Meldung zeigt
    // (parseBackup lehnt unbekannte neuere Versionen ab). pauseMinutes blieb
    // seinerzeit bewusst additiv-tolerant unter Version 1 -- dort ging es nur
    // um ein Zusatzfeld bestehender Einträge, nicht um einen ganzen Bestand.
    schemaVersion: 2,
    exportedAt: nowIso(),
    app: "BR-Log",
    tags,
    entries,
    appointments,
    reminderFired,
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
    // Schlagwort-Labels als Fallback-Beschreibung (Finding 46: teilt sich den
    // Join mit loadRelations statt ihn erneut zu duplizieren).
    const tagsByEntry = await loadTagsByEntryIds(db, conflictIds);
    for (const id of conflictIds) {
      const base = labelById.get(id);
      const tagLabels = (tagsByEntry.get(id) || []).map((t) => t.label).join(", ");
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

  // Termine: dieselbe Last-Writer-Wins-Zählung wie Einträge (importerWins).
  let newAppointments = 0;
  let appointmentConflicts = 0;
  let appointmentUnchanged = 0;
  if (payload.appointments && payload.appointments.length > 0) {
    const localAppts = await db.select<{ id: string; updated_at: string }[]>(
      "SELECT id, updated_at FROM appointments"
    );
    const localApptMap = new Map(localAppts.map((a) => [a.id, a.updated_at]));
    for (const a of payload.appointments) {
      const localUpdated = localApptMap.get(a.id);
      if (localUpdated === undefined) newAppointments++;
      else if (importerWins(localUpdated, a.updatedAt)) appointmentConflicts++;
      else appointmentUnchanged++;
    }
  }
  return {
    newEntries,
    conflicts,
    unchanged,
    newTags,
    conflictItems,
    newAppointments,
    appointmentConflicts,
    appointmentUnchanged,
  };
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
        // Backup-Dateien können unvollständig sein -> Listen/pauseMinutes
        // defensiv absichern (pauseMinutes fehlt z. B. in Backups einer
        // älteren App-Version vor diesem Feld -> 0, s. a. Kommentar bei
        // getAllForBackup/validateBackupEntry).
        entry: {
          ...e,
          tagIds: e.tagIds ?? [],
          objections: e.objections ?? [],
          pauseMinutes: e.pauseMinutes ?? 0,
        },
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

  // 3) Termine mergen (dieselbe LWW-Regel). Master vor Overrides schreiben
  //    (FK parent_id) -- getAllForBackup sortiert bereits so, aber defensiv
  //    erneut sortieren, weil Backups auch von Hand bearbeitet sein können.
  const payloadAppts = payload.appointments ?? [];
  const payloadFired = payload.reminderFired ?? [];
  const writtenApptReminders = new Map<string, AppointmentReminder[]>();
  // Nur laden, wenn das Backup überhaupt Termin-Daten mitbringt (v1-Backups
  // ohne Termine sollen keinen einzigen zusätzlichen Query kosten).
  const localReminderRows =
    payloadAppts.length > 0 || payloadFired.length > 0
      ? await db.select<
          { id: string; appointment_id: string; minutes_before: number }[]
        >("SELECT id, appointment_id, minutes_before FROM appointment_reminders")
      : [];
  const deletedConflictIds = new Set<string>();
  if (payloadAppts.length > 0) {
    const localAppts = await db.select<{ id: string; updated_at: string }[]>(
      "SELECT id, updated_at FROM appointments"
    );
    const localApptMap = new Map(localAppts.map((a) => [a.id, a.updated_at]));
    const payloadApptIds = new Set(payloadAppts.map((a) => a.id));
    // Lokale Overrides nach (parent_id, anchor): Haben zwei Geräte dieselbe
    // Instanz unabhängig bearbeitet, kollidieren zwei UUIDs am selben Anker --
    // ein plain INSERT scheitert dann am UNIQUE-Index idx_appointments_override
    // und reißt die gesamte Import-Transaktion. Stattdessen LWW wie überall.
    const localOverrideRows = await db.select<
      {
        id: string;
        parent_id: string;
        recurrence_anchor: string | null;
        updated_at: string;
      }[]
    >(
      "SELECT id, parent_id, recurrence_anchor, updated_at FROM appointments WHERE parent_id IS NOT NULL"
    );
    const localOverrideByAnchor = new Map(
      localOverrideRows.map((o) => [`${o.parent_id}|${o.recurrence_anchor}`, o])
    );
    const writtenAnchorKeys = new Set<string>();
    const remindersByAppt = new Map<string, AppointmentReminder[]>();
    for (const r of localReminderRows) {
      const arr = remindersByAppt.get(r.appointment_id) || [];
      arr.push({ id: r.id, minutesBefore: r.minutes_before });
      remindersByAppt.set(r.appointment_id, arr);
    }
    const sorted = [...payloadAppts].sort(
      (a, b) => Number(a.parentId != null) - Number(b.parentId != null)
    );
    for (const a of sorted) {
      // Override mit unauflösbarem Master (weder lokal noch im Payload) würde
      // die gesamte Import-Transaktion an der FK-Prüfung scheitern lassen --
      // defensiv überspringen statt alles abzubrechen.
      if (
        a.parentId != null &&
        !localApptMap.has(a.parentId) &&
        !payloadApptIds.has(a.parentId)
      ) {
        continue;
      }
      const localUpdated = localApptMap.get(a.id);
      const isNew = localUpdated === undefined;
      if (!importerWins(localUpdated, a.updatedAt)) continue;
      if (a.parentId != null && a.recurrenceAnchor != null) {
        const key = `${a.parentId}|${a.recurrenceAnchor}`;
        if (writtenAnchorKeys.has(key)) continue; // Payload-interne Dublette
        const conflict = localOverrideByAnchor.get(key);
        if (conflict && conflict.id !== a.id) {
          if (!importerWins(conflict.updated_at, a.updatedAt)) continue; // lokaler Override bleibt
          statements.push(
            {
              sql: "DELETE FROM reminder_fired WHERE appointment_id = ?",
              params: [conflict.id],
            },
            {
              sql: "DELETE FROM appointment_reminders WHERE appointment_id = ?",
              params: [conflict.id],
            },
            {
              sql: "DELETE FROM appointment_tags WHERE appointment_id = ?",
              params: [conflict.id],
            },
            {
              sql: "DELETE FROM appointments WHERE id = ?",
              params: [conflict.id],
            }
          );
          if (isFtsAvailable()) {
            statements.push({
              sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
              params: [conflict.id],
            });
          }
          deletedConflictIds.add(conflict.id);
        }
        writtenAnchorKeys.add(key);
      }
      const appt: Appointment = {
        ...a,
        exdates: a.exdates ?? [],
        tagIds: a.tagIds ?? [],
        reminders: a.reminders ?? [],
        parentId: a.parentId ?? null,
        recurrenceAnchor: a.recurrenceAnchor ?? null,
        rrule: a.rrule ?? null,
        color: a.color ?? null,
        icsUid: a.icsUid ?? null,
        icsSequence: a.icsSequence ?? 0,
      };
      statements.push(
        ...appointmentWriteStatements({
          appt,
          exists: !isNew,
          // Original-Zeitstempel erhalten (Finding 10, wie Einträge).
          updatedAt: a.updatedAt || now,
          createdAtDefault: now,
          tagLabelById,
          existingReminders: remindersByAppt.get(a.id) ?? [],
        })
      );
      writtenApptReminders.set(appt.id, appt.reminders);
    }
  }

  // 4) Feuer-Protokoll übernehmen -- nur Zeilen, deren (Termin, Erinnerung)
  //    nach dem Merge tatsächlich existiert (sonst FK-Abbruch der Transaktion):
  //    für geschriebene Termine gelten die Payload-Erinnerungen, für alle
  //    anderen der lokale Bestand.
  const fired = payloadFired;
  if (fired.length > 0) {
    const localPairs = new Set(
      localReminderRows.map((r) => `${r.appointment_id}|${r.id}`)
    );
    const pairValid = (apptId: string, remId: string): boolean => {
      // Per Anker-Kollision entfernte lokale Overrides existieren nach dem
      // Merge nicht mehr -- ihre Markierungen wären FK-Verletzungen.
      if (deletedConflictIds.has(apptId)) return false;
      const written = writtenApptReminders.get(apptId);
      if (written) return written.some((r) => r.id === remId);
      return localPairs.has(`${apptId}|${remId}`);
    };
    for (const f of fired) {
      if (
        typeof f.appointmentId !== "string" ||
        typeof f.reminderId !== "string" ||
        typeof f.occurrenceAnchor !== "string" ||
        !ISO_DATE_RE.test(f.occurrenceAnchor) ||
        !pairValid(f.appointmentId, f.reminderId)
      ) {
        continue; // Komfort-Daten: defekte/verwaiste Zeilen still überspringen
      }
      statements.push({
        sql: `INSERT OR IGNORE INTO reminder_fired
               (appointment_id, reminder_id, occurrence_anchor, fired_at)
             VALUES (?,?,?,?)`,
        params: [
          f.appointmentId,
          f.reminderId,
          f.occurrenceAnchor,
          typeof f.firedAt === "string" ? f.firedAt : now,
        ],
      });
    }
  }

  await db.batch(statements);
  return summary;
}

/** Höchste vom Code verstandene Backup-Schema-Version (siehe getAllForBackup). */
const SUPPORTED_SCHEMA_VERSION = 2;

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
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag ${index + 1} ist kein gültiges Objekt.`
    );
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag ${index + 1} hat keine gültige ID.`
    );
  }
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat kein gültiges Datum (erwartet JJJJ-MM-TT).`
    );
  }
  if (
    typeof raw.durationMinutes !== "number" ||
    !Number.isFinite(raw.durationMinutes) ||
    raw.durationMinutes < 0
  ) {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat eine ungültige Dauer.`
    );
  }
  // pauseMinutes ist optional (additiv-tolerant, s. getAllForBackup): fehlt es
  // (Backup einer älteren App-Version vor diesem Feld), wird es beim Import
  // als 0 behandelt (s. applyImport). Ist es gesetzt, muss es wie
  // durationMinutes eine gültige, nicht-negative Zahl sein.
  if (
    raw.pauseMinutes !== undefined &&
    (typeof raw.pauseMinutes !== "number" ||
      !Number.isFinite(raw.pauseMinutes) ||
      raw.pauseMinutes < 0)
  ) {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat eine ungültige Pause.`
    );
  }
  if (raw.tagIds !== undefined && !Array.isArray(raw.tagIds)) {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat ungültige Schlagwort-Zuordnungen.`
    );
  }
  if (raw.objections !== undefined && !Array.isArray(raw.objections)) {
    throw new AppError(
      `Ungültige Backup-Datei: Eintrag „${raw.id}“ hat ungültige Widersprüche.`
    );
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/**
 * Pflichtfeld-/Typprüfung je importiertem Termin (Muster validateBackupEntry):
 * wirft mit konkreter deutscher Meldung VOR dem ersten Schreibzugriff, statt
 * den Fehler als CHECK-/FK-Verletzung mitten in der Import-Transaktion zu
 * erleben (die appointments-Tabelle hat strenge CHECKs, s. Migration 3).
 */
function validateBackupAppointment(raw: unknown, index: number): void {
  if (!isPlainObject(raw)) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin ${index + 1} ist kein gültiges Objekt.`
    );
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    throw new AppError(
      `Ungültige Backup-Datei: Termin ${index + 1} hat keine gültige ID.`
    );
  }
  if (typeof raw.startDate !== "string" || !ISO_DATE_RE.test(raw.startDate)) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ hat kein gültiges Startdatum (erwartet JJJJ-MM-TT).`
    );
  }
  if (typeof raw.endDate !== "string" || !ISO_DATE_RE.test(raw.endDate)) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ hat kein gültiges Enddatum (erwartet JJJJ-MM-TT).`
    );
  }
  if (raw.endDate < raw.startDate) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ endet vor seinem Beginn.`
    );
  }
  const isAllDay = raw.isAllDay === true;
  const validTime = (v: unknown) => typeof v === "string" && HHMM_RE.test(v);
  if (isAllDay) {
    if (raw.startTime != null || raw.endTime != null) {
      throw new AppError(
        `Ungültige Backup-Datei: Ganztägiger Termin „${raw.id}“ darf keine Uhrzeiten haben.`
      );
    }
  } else if (!validTime(raw.startTime) || !validTime(raw.endTime)) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ hat keine gültigen Uhrzeiten (erwartet HH:MM).`
    );
  } else if (
    raw.startDate === raw.endDate &&
    (raw.endTime as string) < (raw.startTime as string)
  ) {
    // Kein DB-CHECK prüft die Zeit-Reihenfolge am selben Tag -- eine negative
    // Dauer würde sonst klaglos gespeichert und falsch angezeigt.
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ endet vor seinem Beginn.`
    );
  }
  if (
    raw.exdates !== undefined &&
    (!Array.isArray(raw.exdates) ||
      raw.exdates.some((x) => typeof x !== "string" || !ISO_DATE_RE.test(x)))
  ) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ hat ungültige Serien-Ausnahmen.`
    );
  }
  // Override-Kopplung wie die DB-CHECKs: parentId erzwingt Anker, verbietet rrule.
  const hasParent = typeof raw.parentId === "string" && raw.parentId !== "";
  if (hasParent) {
    if (
      typeof raw.recurrenceAnchor !== "string" ||
      !ISO_DATE_RE.test(raw.recurrenceAnchor)
    ) {
      throw new AppError(
        `Ungültige Backup-Datei: Serien-Ausnahme „${raw.id}“ hat keinen gültigen Instanz-Anker.`
      );
    }
    if (raw.rrule != null) {
      throw new AppError(
        `Ungültige Backup-Datei: Serien-Ausnahme „${raw.id}“ darf keine eigene Serienregel haben.`
      );
    }
  }
  if (raw.tagIds !== undefined && !Array.isArray(raw.tagIds)) {
    throw new AppError(
      `Ungültige Backup-Datei: Termin „${raw.id}“ hat ungültige Schlagwort-Zuordnungen.`
    );
  }
  if (raw.reminders !== undefined) {
    if (
      !Array.isArray(raw.reminders) ||
      raw.reminders.some(
        (r) =>
          !isPlainObject(r) ||
          typeof r.id !== "string" ||
          r.id.trim() === "" ||
          typeof r.minutesBefore !== "number" ||
          !Number.isFinite(r.minutesBefore) ||
          r.minutesBefore < 0
      )
    ) {
      throw new AppError(
        `Ungültige Backup-Datei: Termin „${raw.id}“ hat ungültige Erinnerungen.`
      );
    }
  }
}

export function parseBackup(raw: string): BackupPayload {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("Ungültige Backup-Datei: Die Datei enthält kein gültiges JSON.");
  }
  if (!isPlainObject(data) || !Array.isArray(data.entries)) {
    throw new AppError("Ungültige Backup-Datei: 'entries' fehlt.");
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
    throw new AppError(
      `Ungültige Backup-Datei: Unbekannte Schema-Version (${String(
        data.schemaVersion
      )}). Diese App-Version unterstützt Backups bis Version ${SUPPORTED_SCHEMA_VERSION} – bitte die App aktualisieren.`
    );
  }
  data.entries.forEach((e, i) => validateBackupEntry(e, i));
  if (!Array.isArray(data.tags)) data.tags = [];
  // Termine sind optional (v1-Backups haben das Feld nicht); wenn vorhanden,
  // gelten dieselben strengen Prüfungen wie für Einträge.
  if (data.appointments !== undefined) {
    if (!Array.isArray(data.appointments)) {
      throw new AppError(
        "Ungültige Backup-Datei: 'appointments' ist keine Liste."
      );
    }
    data.appointments.forEach((a, i) => validateBackupAppointment(a, i));
  }
  if (data.reminderFired !== undefined && !Array.isArray(data.reminderFired)) {
    // Defekte Feuer-Protokolle sind kein Grund, den ganzen Import zu
    // verweigern -- sie sind reine Komfort-Daten (verhindern Doppel-Feuern).
    data.reminderFired = [];
  }
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

/** FTS-Statements (DELETE+INSERT) für bereits hydratisierte Termine. */
function ftsStatementsForAppointments(
  items: AppointmentFullItem[]
): BatchStatement[] {
  const st: BatchStatement[] = [];
  for (const it of items) {
    st.push(
      ...apptFtsUpsertStatements({
        appointmentId: it.id,
        title: it.title,
        location: it.location,
        description: it.description,
        tagLabels: it.tagLabels,
        secretDetails: it.secretDetails,
      })
    );
  }
  return st;
}

/**
 * Baut beide FTS-Indizes vollständig neu auf (leeren + aus dem Bestand füllen).
 * Aufrufbar für Wartung/nach Schemaänderungen; No-Op ohne FTS5.
 */
export async function rebuildFts(): Promise<void> {
  if (!isFtsAvailable()) return;
  const db = await getDb();
  const rows = await db.select<EntryRow[]>("SELECT * FROM entries");
  const items = await hydrateFullEntries(rows);
  const apptRows = await db.select<AppointmentRow[]>("SELECT * FROM appointments");
  const apptItems = await hydrateFullAppointments(apptRows);
  const statements: BatchStatement[] = [
    { sql: "DELETE FROM entries_fts", params: [] },
    ...ftsStatementsForItems(items),
    { sql: "DELETE FROM appointments_fts", params: [] },
    ...ftsStatementsForAppointments(apptItems),
  ];
  await db.batch(statements);
}

// ---------- Auswertung (reine Lese-Aggregationen -- GROUP BY über die
// bestehende db_select-Fassade, KEINE Schreibpfad-Änderung; Finding 12/14) ----------

export interface PeriodFilter {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

export interface MonthSum {
  month: string; // YYYY-MM
  minutes: number;
}
export interface YearSum {
  year: string; // YYYY
  minutes: number;
}
export interface TagSum {
  tagId: string;
  label: string;
  minutes: number;
}

export interface StatsSummary {
  // BR-Arbeitszeit im Zeitraum. Freizeitausgleich-Einträge (is_compensation)
  // sind KEINE BR-Tätigkeit und daher hier bewusst ausgeschlossen -- sie laufen
  // separat über getCompensationBalance() (Finding 14: "Ausgleichs-Einträge
  // werden aus den BR-Zeit-Summen herausgehalten und separat ausgewiesen").
  totalMinutes: number;
  monthSums: MonthSum[];
  yearSums: YearSum[];
  // Summen je Schlagwort NUR für Einträge mit GENAU einem Schlagwort. Schlag-
  // wörter sind eine n:m-Beziehung (entry_tags) -- bei Mehrfachauswahl lässt
  // sich die Dauer eines Eintrags nicht widerspruchsfrei auf mehrere Kate-
  // gorien aufteilen. Statt die Tag-Summen durch Mehrfachzählung zu verfäl-
  // schen, landen solche Einträge gesammelt in multiTagMinutes ("nicht
  // aufteilbar") -- die Gesamtsumme (totalMinutes) bleibt dabei korrekt.
  tagSums: TagSum[];
  multiTagMinutes: number; // Sammelposten "Einträge mit mehreren Schlagwörtern"
  untaggedMinutes: number; // Einträge ganz ohne Schlagwort
  outsidePlannedShiftMinutes: number; // had_planned_shift = 0
  objectionEntryCount: number; // Einträge mit mindestens einem Widerspruch
  objectionCount: number; // Anzahl aller Widersprüche
}

function num(v: number | null | undefined): number {
  return v ?? 0;
}

/** Baut die WHERE-Klausel-Fragmente (ohne "WHERE") für ein optionales Von/Bis. */
function dateWhereFragments(
  filter: PeriodFilter,
  colPrefix: string
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.from) {
    clauses.push(`${colPrefix}date >= ?`);
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push(`${colPrefix}date <= ?`);
    params.push(filter.to);
  }
  return { clauses, params };
}

/**
 * Monats-/Jahres-/Schlagwort-Summen, Anteil außerhalb der geplanten Schicht
 * und Widerspruchs-Zählung für den optionalen Zeitraum (Finding 12). Reine
 * Lese-Aggregationen (GROUP BY) über die bestehende db_select-Fassade -- kein
 * neuer Rust-Command, keine Schreibpfad-Änderung.
 */
export async function getStatsSummary(
  filter: PeriodFilter = {}
): Promise<StatsSummary> {
  const db = await getDb();
  const { clauses: dateClauses, params: dateParams } = dateWhereFragments(
    filter,
    ""
  );
  const { clauses: eDateClauses } = dateWhereFragments(filter, "e.");
  const workWhere =
    "WHERE " + ["is_compensation = 0", ...dateClauses].join(" AND ");
  const eWorkWhere =
    "WHERE " + ["e.is_compensation = 0", ...eDateClauses].join(" AND ");

  const [
    totalRows,
    monthSums,
    yearSums,
    tagSums,
    multiRows,
    untaggedRows,
    outsideRows,
    objRows,
  ] = await Promise.all([
    db.select<{ minutes: number | null }[]>(
      `SELECT SUM(duration_minutes) as minutes FROM entries ${workWhere}`,
      dateParams
    ),
    db.select<MonthSum[]>(
      `SELECT substr(date,1,7) as month, SUM(duration_minutes) as minutes
         FROM entries ${workWhere} GROUP BY month ORDER BY month`,
      dateParams
    ),
    db.select<YearSum[]>(
      `SELECT substr(date,1,4) as year, SUM(duration_minutes) as minutes
         FROM entries ${workWhere} GROUP BY year ORDER BY year`,
      dateParams
    ),
    db.select<TagSum[]>(
      `SELECT t.id as tagId, t.label as label, SUM(e.duration_minutes) as minutes
         FROM entries e
         JOIN entry_tags et ON et.entry_id = e.id
         JOIN task_tags t ON t.id = et.tag_id
         ${eWorkWhere}
           AND e.id IN (SELECT entry_id FROM entry_tags GROUP BY entry_id HAVING COUNT(*) = 1)
        GROUP BY t.id, t.label
        ORDER BY minutes DESC`,
      dateParams
    ),
    db.select<{ minutes: number | null }[]>(
      `SELECT SUM(duration_minutes) as minutes FROM entries e ${eWorkWhere}
         AND e.id IN (SELECT entry_id FROM entry_tags GROUP BY entry_id HAVING COUNT(*) > 1)`,
      dateParams
    ),
    db.select<{ minutes: number | null }[]>(
      `SELECT SUM(duration_minutes) as minutes FROM entries e ${eWorkWhere}
         AND e.id NOT IN (SELECT entry_id FROM entry_tags)`,
      dateParams
    ),
    db.select<{ minutes: number | null }[]>(
      `SELECT SUM(duration_minutes) as minutes FROM entries WHERE ${[
        "had_planned_shift = 0",
        "is_compensation = 0",
        ...dateClauses,
      ].join(" AND ")}`,
      dateParams
    ),
    db.select<{ entryCount: number | null; objCount: number | null }[]>(
      `SELECT COUNT(DISTINCT o.entry_id) as entryCount, COUNT(*) as objCount
         FROM objections o JOIN entries e ON e.id = o.entry_id
         ${eDateClauses.length ? "WHERE " + eDateClauses.join(" AND ") : ""}`,
      dateParams
    ),
  ]);

  return {
    totalMinutes: num(totalRows[0]?.minutes),
    monthSums: monthSums.map((m) => ({ month: m.month, minutes: num(m.minutes) })),
    yearSums: yearSums.map((y) => ({ year: y.year, minutes: num(y.minutes) })),
    tagSums: tagSums.map((t) => ({
      tagId: t.tagId,
      label: t.label,
      minutes: num(t.minutes),
    })),
    multiTagMinutes: num(multiRows[0]?.minutes),
    untaggedMinutes: num(untaggedRows[0]?.minutes),
    outsidePlannedShiftMinutes: num(outsideRows[0]?.minutes),
    objectionEntryCount: num(objRows[0]?.entryCount),
    objectionCount: num(objRows[0]?.objCount),
  };
}

export interface CompensationMonthBalance {
  month: string; // YYYY-MM
  credit: number; // Guthaben-Zuwachs in diesem Monat
  used: number; // Verbrauch in diesem Monat
}

export interface CompensationBalance {
  credit: number; // Guthaben (laufend gesamt): Σ Minuten, hadPlannedShift=false ∧ NICHT isCompensation
  used: number; // Verbrauch (laufend gesamt): Σ Minuten, isCompensation=true
  balance: number; // credit - used
  byMonth: CompensationMonthBalance[];
}

/**
 * Freizeitausgleich-Saldo nach § 37 Abs. 3 BetrVG (Finding 14). Läuft IMMER
 * über den GESAMTEN Datenbestand, unabhängig von einem in der UI gewählten
 * Zeitraum -- ein Saldo ist per Definition eine laufende Größe, keine
 * Momentaufnahme eines Ausschnitts. Guthaben: BR-Zeit außerhalb der geplanten
 * Schicht, die (noch) nicht als Ausgleich verbucht ist. Verbrauch: als
 * Freizeitausgleich markierte Einträge (is_compensation).
 */
export async function getCompensationBalance(): Promise<CompensationBalance> {
  const db = await getDb();
  const [creditRows, usedRows, byMonthRows] = await Promise.all([
    db.select<{ minutes: number | null }[]>(
      "SELECT SUM(duration_minutes) as minutes FROM entries WHERE had_planned_shift = 0 AND is_compensation = 0"
    ),
    db.select<{ minutes: number | null }[]>(
      "SELECT SUM(duration_minutes) as minutes FROM entries WHERE is_compensation = 1"
    ),
    db.select<
      { month: string; credit: number | null; used: number | null }[]
    >(
      `SELECT substr(date,1,7) as month,
              SUM(CASE WHEN had_planned_shift = 0 AND is_compensation = 0 THEN duration_minutes ELSE 0 END) as credit,
              SUM(CASE WHEN is_compensation = 1 THEN duration_minutes ELSE 0 END) as used
         FROM entries
        WHERE (had_planned_shift = 0 AND is_compensation = 0) OR is_compensation = 1
        GROUP BY month
        ORDER BY month`
    ),
  ]);
  const credit = num(creditRows[0]?.minutes);
  const used = num(usedRows[0]?.minutes);
  return {
    credit,
    used,
    balance: credit - used,
    byMonth: byMonthRows.map((r) => ({
      month: r.month,
      credit: num(r.credit),
      used: num(r.used),
    })),
  };
}

/**
 * Gleicht den FTS-Index mit dem Datenbestand ab: fehlende Einträge nachtragen,
 * Geisterzeilen entfernen. Läuft beim Start (initSearch) und deckt Migrationen
 * sowie einen erstmals verfügbaren FTS5-Build ab. No-Op bei Übereinstimmung.
 */
export async function reconcileFts(): Promise<void> {
  if (!isFtsAvailable()) return;
  const db = await getDb();
  const statements: BatchStatement[] = [];

  // Einträge (entries_fts).
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

  // Termine (appointments_fts) -- gleicher Abgleich.
  const apptIds = (
    await db.select<{ id: string }[]>("SELECT id FROM appointments")
  ).map((r) => r.id);
  const apptFtsIds = (
    await db.select<{ appointment_id: string }[]>(
      "SELECT appointment_id FROM appointments_fts"
    )
  ).map((r) => r.appointment_id);
  const apptSet = new Set(apptIds);
  const apptFtsSet = new Set(apptFtsIds);
  const apptMissing = apptIds.filter((id) => !apptFtsSet.has(id));
  const apptGhosts = apptFtsIds.filter((id) => !apptSet.has(id));
  for (const id of apptGhosts) {
    statements.push({
      sql: "DELETE FROM appointments_fts WHERE appointment_id = ?",
      params: [id],
    });
  }
  if (apptMissing.length > 0) {
    const rows = await selectByIdChunks<AppointmentRow>(
      db,
      apptMissing,
      (ph) => `SELECT * FROM appointments WHERE id IN (${ph})`
    );
    const items = await hydrateFullAppointments(rows);
    statements.push(...ftsStatementsForAppointments(items));
  }

  if (statements.length === 0) return;
  await db.batch(statements);
}

/**
 * Trägt `series_end_date` für Bestands-Serien-Master nach, die noch keinen
 * Wert tragen (angelegt vor Migration 4; appointmentWriteStatements pflegt
 * die Spalte für neue Schreibvorgänge bereits automatisch mit). Läuft bei
 * JEDEM Start (client.ts, direkt neben reconcileFts, gleicher Best-effort-
 * Charakter) -- endlose/unbekannte Serien bleiben NULL und kosten pro Start
 * nur den (billigen) RRULE-Parse; beendete Serien verlassen damit dauerhaft
 * den Lade-Hot-Path von listAppointmentsRange.
 */
export async function backfillSeriesEndDates(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<
    {
      id: string;
      rrule: string;
      start_date: string;
      end_date: string;
      start_time: string | null;
      is_all_day: number;
    }[]
  >(
    `SELECT id, rrule, start_date, end_date, start_time, is_all_day
       FROM appointments
      WHERE rrule IS NOT NULL AND parent_id IS NULL AND series_end_date IS NULL`
  );
  const updates: BatchStatement[] = [];
  for (const r of rows) {
    const end = seriesEndDateFor({
      rrule: r.rrule,
      startDate: r.start_date,
      endDate: r.end_date,
      startTime: r.start_time,
      isAllDay: r.is_all_day === 1,
    });
    if (end !== null)
      updates.push({
        sql: "UPDATE appointments SET series_end_date = ? WHERE id = ?",
        params: [end, r.id],
      });
  }
  if (updates.length > 0) await db.batch(updates);
}
