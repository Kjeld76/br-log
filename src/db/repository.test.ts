import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, BackupPayload, TimeEntry } from "../types";

// DB-Schicht komplett mocken (austauschbare Schicht, siehe client.ts) -> die
// repository.ts-Logik wird gegen den Mock getestet, ohne echtes SQLite/Tauri.
const selectMock = vi.fn();
const executeMock = vi.fn();
const batchMock = vi.fn();
const isFtsAvailableMock = vi.fn();

vi.mock("./client", () => ({
  getDb: vi.fn(async () => ({
    select: selectMock,
    execute: executeMock,
    batch: batchMock,
  })),
  isFtsAvailable: () => isFtsAvailableMock(),
}));

// Nach dem Mock importieren, damit repository.ts den Mock statt der echten
// client.ts verwendet.
const repo = await import("./repository");

function baseEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    date: "2026-01-15",
    startTime: "08:00",
    endTime: "16:00",
    durationMinutes: 480,
    pauseMinutes: 0,
    infoForManagement: "Schulung",
    secretDetails: "",
    hadPlannedShift: true,
    shiftCompensationNote: "",
    tagIds: [],
    objections: [],
    createdAt: "2026-01-15T08:00:00.000Z",
    updatedAt: "2026-01-15T08:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  selectMock.mockReset();
  executeMock.mockReset();
  batchMock.mockReset();
  isFtsAvailableMock.mockReset();
  isFtsAvailableMock.mockReturnValue(false); // FTS-Pflege ist nicht Gegenstand dieser Tests
  executeMock.mockResolvedValue(0);
  batchMock.mockResolvedValue(undefined);
});

/** Findet ein Statement im (einzigen) db_batch-Aufruf anhand eines SQL-Präfixes. */
function batchStatement(prefix: string) {
  const statements = batchMock.mock.calls[0][0] as {
    sql: string;
    params: unknown[];
  }[];
  return statements.find((s) => s.sql.startsWith(prefix));
}

describe("saveEntry", () => {
  it("fügt einen neuen Eintrag ein (INSERT), wenn die ID noch nicht existiert", async () => {
    selectMock
      .mockResolvedValueOnce([]) // "SELECT id FROM entries WHERE id = ?" -> nicht vorhanden
      .mockResolvedValueOnce([{ id: "tag-1", label: "Tag 1" }]); // loadTagLabels
    const entry = baseEntry({ tagIds: ["tag-1"] });

    await repo.saveEntry(entry);

    // Alle Schreib-Statements laufen atomar in EINER db_batch-Transaktion.
    expect(batchMock).toHaveBeenCalledTimes(1);
    const insert = batchStatement("INSERT INTO entries");
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual([
      entry.id,
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.durationMinutes,
      entry.pauseMinutes,
      entry.infoForManagement,
      entry.secretDetails,
      1, // hadPlannedShift: true -> 1
      entry.shiftCompensationNote,
      0, // isCompensation: undefined -> 0
      entry.createdAt,
      expect.any(String), // now
    ]);

    // Tags neu gesetzt: erst löschen, dann pro (gültigem) Tag einfügen.
    expect(batchStatement("DELETE FROM entry_tags")!.params).toEqual([entry.id]);
    expect(batchStatement("INSERT OR IGNORE INTO entry_tags")!.params).toEqual([
      entry.id,
      "tag-1",
    ]);
  });

  it("aktualisiert einen bestehenden Eintrag (UPDATE), wenn die ID schon existiert", async () => {
    selectMock.mockResolvedValueOnce([{ id: "entry-1" }]); // existiert bereits
    const entry = baseEntry();

    await repo.saveEntry(entry);

    expect(batchMock).toHaveBeenCalledTimes(1);
    const update = batchStatement("UPDATE entries SET");
    expect(update).toBeDefined();
    expect(update!.params).toEqual([
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.durationMinutes,
      entry.pauseMinutes,
      entry.infoForManagement,
      entry.secretDetails,
      1,
      entry.shiftCompensationNote,
      0, // isCompensation: undefined -> 0
      expect.any(String), // now
      entry.id,
    ]);
    expect(batchStatement("INSERT INTO entries")).toBeUndefined();
  });

  it("überspringt komplett leere Widerspruchszeilen (kein reason/byWhom)", async () => {
    selectMock.mockResolvedValueOnce([]);
    const entry = baseEntry({
      objections: [
        { id: "", reason: "  ", byWhom: "  ", date: null }, // leer -> raus
        { id: "", reason: "Grund", byWhom: "", date: null }, // nicht leer -> bleibt
      ],
    });

    await repo.saveEntry(entry);

    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    const objectionInserts = statements.filter((s) =>
      s.sql.startsWith("INSERT INTO objections")
    );
    expect(objectionInserts).toHaveLength(1);
    expect(objectionInserts[0].params[1]).toBe(entry.id);
    expect(objectionInserts[0].params[2]).toBe("Grund");
  });

  it("schreibt eine gesetzte pauseMinutes korrekt in Spalte + Parameter (INSERT)", async () => {
    selectMock.mockResolvedValueOnce([]);
    const entry = baseEntry({ pauseMinutes: 30 });

    await repo.saveEntry(entry);

    const insert = batchStatement("INSERT INTO entries");
    expect(insert!.sql).toContain("pause_minutes");
    // Spaltenposition in entryWriteStatements: id,date,start,end,duration,pause,...
    expect(insert!.params[5]).toBe(30);
  });
});

describe("createTag", () => {
  it("legt ein neues Schlagwort an und trimmt das Label", async () => {
    selectMock.mockResolvedValueOnce([]); // COLLATE-NOCASE-Check: kein Treffer

    const tag = await repo.createTag("  Fahrzeit  ");

    expect(tag.label).toBe("Fahrzeit");
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO task_tags");
    expect(params).toEqual([tag.id, "Fahrzeit"]);
  });

  it("wirft bei case-insensitivem Duplikat und legt nichts an", async () => {
    selectMock.mockResolvedValueOnce([{ id: "vorhanden" }]); // Label existiert bereits

    await expect(repo.createTag("fahrzeit")).rejects.toThrow(
      "existiert bereits"
    );
    // Prüf-SELECT case-insensitiv, kein INSERT.
    expect(selectMock.mock.calls[0][0]).toContain("COLLATE NOCASE");
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("renameTag", () => {
  it("zieht auch den Termin-FTS-Index nach (Tag-Label ist Teil des public_content)", async () => {
    // Ohne den Nachzug findet die FTS-Terminsuche einen Termin nach der
    // Umbenennung dauerhaft über den ALTEN Tag-Namen, nie über den neuen --
    // reconcileFts repariert nur ID-Differenzen, keinen veralteten Inhalt.
    isFtsAvailableMock.mockReturnValue(true);
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT entry_id FROM entry_tags")) return [];
      if (sql.startsWith("SELECT appointment_id FROM appointment_tags"))
        return [{ appointment_id: "appt-1" }];
      if (sql.startsWith("SELECT * FROM appointments"))
        return [
          {
            id: "appt-1",
            title: "BR-Sitzung",
            location: "",
            description: "",
            secret_details: "",
            is_all_day: 0,
            start_date: "2026-07-20",
            start_time: "09:00",
            end_date: "2026-07-20",
            end_time: "11:00",
            is_important: 0,
            color: null,
            rrule: null,
            exdates: "[]",
            parent_id: null,
            recurrence_anchor: null,
            ics_uid: null,
            ics_sequence: 0,
            created_at: "t",
            updated_at: "t",
          },
        ];
      if (sql.includes("FROM appointment_tags et JOIN task_tags t"))
        return [{ owner_id: "appt-1", id: "tag-1", label: "Sitzung" }];
      if (sql.startsWith("SELECT id, appointment_id, minutes_before")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    await repo.renameTag("tag-1", "BR-Sitzung NEU");

    const fts = batchStatement("INSERT INTO appointments_fts");
    expect(fts).toBeDefined();
    expect(fts!.params[0]).toBe("appt-1");
    expect(String(fts!.params[1])).toContain("BR-Sitzung NEU");
  });
});

describe("listEntries – Filterbau", () => {
  it("baut WHERE/Params aus from/to/tagIds ohne Volltextsuche", async () => {
    selectMock.mockResolvedValueOnce([]); // Haupt-SELECT: keine Treffer -> hydrateEntries kurzgeschlossen

    await repo.listEntries({
      from: "2026-01-01",
      to: "2026-01-31",
      tagIds: ["a", "b"],
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    const [sql, params] = selectMock.mock.calls[0];
    expect(sql).toContain("e.date >= ?");
    expect(sql).toContain("e.date <= ?");
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (?,?))"
    );
    expect(params).toEqual(["2026-01-01", "2026-01-31", "a", "b"]);
  });

  it("lädt secret_details NICHT (schlanke Spaltenliste, kein Klartext-Leak)", async () => {
    selectMock
      .mockResolvedValueOnce([
        {
          id: "e1",
          date: "2026-01-15",
          start_time: null,
          end_time: null,
          duration_minutes: 60,
          pause_minutes: 0,
          info_for_management: "Info",
          had_planned_shift: 1,
          shift_compensation_note: "",
          is_compensation: 0,
          created_at: "2026-01-15T00:00:00.000Z",
          updated_at: "2026-01-15T00:00:00.000Z",
        },
      ]) // Haupt-SELECT (schlanke Zeile ohne secret_details)
      .mockResolvedValueOnce([]) // Schlagwörter
      .mockResolvedValueOnce([]); // Widersprüche

    const items = await repo.listEntries({});

    const [sql] = selectMock.mock.calls[0];
    expect(sql).not.toContain("secret_details");
    expect(sql).not.toContain("e.*");
    expect(items[0]).not.toHaveProperty("secretDetails");
  });

  it("liefert bei Volltextsuche ohne Treffer sofort [] ohne weiteren DB-Zugriff", async () => {
    isFtsAvailableMock.mockReturnValue(true);
    selectMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // pub + sec MATCH: keine Treffer

    const result = await repo.listEntries({ term: "nirgends" });

    expect(result).toEqual([]);
    // Nur die zwei MATCH-Abfragen, keine Haupt-Abfrage auf entries.
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("schränkt bei Volltextsuche mit Treffern auf e.id IN (...) ein", async () => {
    isFtsAvailableMock.mockReturnValue(true);
    selectMock
      .mockResolvedValueOnce([{ id: "entry-1" }]) // public_content-Treffer (searchHitsFor aliast AS id)
      .mockResolvedValueOnce([]) // secret_content: kein Treffer
      .mockResolvedValueOnce([]); // Haupt-SELECT (Rückgabe-Inhalt hier irrelevant)

    await repo.listEntries({ term: "foo" });

    const mainCall = selectMock.mock.calls[2];
    expect(mainCall[0]).toContain("e.id IN (?)");
    expect(mainCall[1]).toEqual(["entry-1"]);
  });
});

describe("analyzeImport – Konfliktlogik", () => {
  it("erkennt neue, in Konflikt stehende und unveränderte Einträge korrekt", async () => {
    selectMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) {
        return [
          { id: "local-conflict", updated_at: "2026-01-01T00:00:00.000Z" },
          { id: "local-unchanged", updated_at: "2026-01-10T00:00:00.000Z" },
        ];
      }
      if (sql.startsWith("SELECT e.id, e.date, e.info_for_management")) {
        expect(params).toEqual(["local-conflict"]);
        return [
          { id: "local-conflict", date: "2026-01-01", info_for_management: "Alte Info" },
        ];
      }
      if (sql.includes("FROM entry_tags et JOIN task_tags t")) {
        return [];
      }
      if (sql.startsWith("SELECT id, label FROM task_tags")) {
        return [{ id: "tag-existing", label: "Bestehend" }];
      }
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [
        { id: "tag-existing", label: "Bestehend", archived: false },
        { id: "tag-new", label: "Neu", archived: false },
      ],
      entries: [
        baseEntry({ id: "new-entry", updatedAt: "2026-01-20T00:00:00.000Z" }),
        baseEntry({
          id: "local-conflict",
          updatedAt: "2026-01-15T00:00:00.000Z", // neuer als lokal -> Konflikt, Import gewinnt
        }),
        baseEntry({
          id: "local-unchanged",
          updatedAt: "2026-01-05T00:00:00.000Z", // älter als lokal -> bleibt unverändert
        }),
      ],
    };

    const summary = await repo.analyzeImport(payload);

    expect(summary.newEntries).toBe(1);
    expect(summary.conflicts).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.newTags).toBe(1);
    expect(summary.conflictItems).toEqual([
      { id: "local-conflict", date: "2026-01-01", label: "Alte Info" },
    ]);
  });

  it("zählt newTags wie applyImport: case-insensitive Label-Duplikate (lokal und im Payload) nicht", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return [];
      if (sql.startsWith("SELECT id, label FROM task_tags"))
        return [{ id: "local-1", label: "Fahrzeit" }];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [
        { id: "imp-1", label: "fahrzeit", archived: false }, // Dup zu lokal -> zählt nicht
        { id: "imp-2", label: "Sitzung", archived: false }, // neu -> zählt
        { id: "imp-3", label: "sitzung", archived: false }, // Payload-interner Dup -> zählt nicht
      ],
      entries: [],
    };

    const summary = await repo.analyzeImport(payload);

    expect(summary.newTags).toBe(1);
  });
});

describe("applyImport – atomarer Merge", () => {
  it("mergt in EINER Transaktion, überspringt label-doppelte Tags und filtert deren Referenzen", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return []; // lokal leer -> alles neu
      // analyzeImport (newTags) und applyImport (bestehende Tags) lesen beide
      // `SELECT id, label FROM task_tags`.
      if (sql.startsWith("SELECT id, label FROM task_tags"))
        return [{ id: "local-x", label: "Fahrzeit" }];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [
        { id: "imp-1", label: "fahrzeit", archived: false }, // Label-Duplikat (case-insensitiv) -> übersprungen
        { id: "imp-2", label: "Sitzung", archived: false }, // neu -> angelegt
      ],
      entries: [baseEntry({ id: "e-new", tagIds: ["imp-1", "imp-2"] })],
    };

    await repo.applyImport(payload);

    // Gesamter Merge in EINER db_batch-Transaktion.
    expect(batchMock).toHaveBeenCalledTimes(1);
    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];

    // imp-1 wird wegen des Label-Duplikats NICHT angelegt, imp-2 schon.
    const tagInserts = statements.filter((s) =>
      s.sql.startsWith("INSERT OR IGNORE INTO task_tags")
    );
    expect(tagInserts.map((s) => s.params[0])).toEqual(["imp-2"]);

    // Neuer Eintrag als INSERT.
    expect(statements.some((s) => s.sql.startsWith("INSERT INTO entries"))).toBe(
      true
    );

    // entry_tags nur für gültige Tags: imp-1 (nicht angelegt) wird herausgefiltert.
    const etInserts = statements.filter((s) =>
      s.sql.startsWith("INSERT OR IGNORE INTO entry_tags")
    );
    expect(etInserts.map((s) => s.params[1])).toEqual(["imp-2"]);
  });

  it("erhält den ORIGINALEN updated_at aus dem Backup, statt auf 'jetzt' zu stempeln (Finding 10)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return []; // lokal leer -> Eintrag ist neu
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const importedUpdatedAt = "2026-01-10T09:00:00.000Z"; // deutlich in der Vergangenheit
    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [baseEntry({ id: "e-new", updatedAt: importedUpdatedAt })],
    };

    await repo.applyImport(payload);

    const insert = batchStatement("INSERT INTO entries");
    expect(insert).toBeDefined();
    // Letzter Parameter des INSERT ist updated_at (s. entryWriteStatements) --
    // muss der importierte Zeitstempel sein, NICHT ein frisch generiertes 'jetzt'.
    expect(insert!.params[insert!.params.length - 1]).toBe(importedUpdatedAt);
  });

  it("setzt eine fehlende pauseMinutes im Backup-Eintrag defensiv auf 0 (additiv-tolerantes Feld)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return [];
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    // Backup einer älteren App-Version: kein pauseMinutes-Feld am Eintrag.
    const { pauseMinutes: _omit, ...entryWithoutPause } = baseEntry({ id: "e-old" });
    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [entryWithoutPause as unknown as TimeEntry],
    };

    await repo.applyImport(payload);

    const insert = batchStatement("INSERT INTO entries");
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("pause_minutes");
    expect(insert!.params[5]).toBe(0);
  });

  it("nutzt eine vorab berechnete Summary (precomputedSummary), ohne die Konflikt-Analyse erneut auszuführen", async () => {
    let analyzeQueryCount = 0;
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) {
        analyzeQueryCount++;
        return [];
      }
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: "2026-01-20T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [baseEntry({ id: "e-new" })],
    };
    const precomputed = {
      newEntries: 1,
      conflicts: 0,
      unchanged: 0,
      newTags: 0,
      conflictItems: [],
    };

    const summary = await repo.applyImport(payload, precomputed);

    // Die übergebene Summary wird 1:1 zurückgegeben (keine erneute Voll-Analyse).
    expect(summary).toBe(precomputed);
    // "SELECT id, updated_at FROM entries" läuft dennoch genau EINMAL (für den
    // tatsächlichen Schreibvorgang) -- nicht zweimal wie bei doppelter
    // analyzeImport-Ausführung.
    expect(analyzeQueryCount).toBe(1);
  });
});

describe("parseBackup", () => {
  it("parst ein gültiges Backup und ergänzt eine fehlende tags-Liste", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      app: "BR-Log",
      entries: [],
    });
    const result = repo.parseBackup(raw);
    expect(result.tags).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  it("lässt eine vorhandene tags-Liste unverändert", () => {
    const raw = JSON.stringify({
      entries: [],
      tags: [{ id: "t1", label: "X", archived: false }],
    });
    const result = repo.parseBackup(raw);
    expect(result.tags).toHaveLength(1);
  });

  it("wirft bei fehlendem/ungültigem entries-Feld", () => {
    expect(() => repo.parseBackup(JSON.stringify({}))).toThrow(
      "Ungültige Backup-Datei"
    );
    expect(() =>
      repo.parseBackup(JSON.stringify({ entries: "kaputt" }))
    ).toThrow("Ungültige Backup-Datei");
  });

  it("wirft bei kaputtem JSON", () => {
    expect(() => repo.parseBackup("{nicht json")).toThrow();
  });

  it("parst einen vollständig gültigen Eintrag anstandslos (Feldvalidierung, Finding 1)", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          id: "e1",
          date: "2026-01-15",
          durationMinutes: 60,
          tagIds: ["t1"],
          objections: [],
        },
      ],
    });
    const result = repo.parseBackup(raw);
    expect(result.entries).toHaveLength(1);
  });

  it("wirft bei einer unbekannten/zukünftigen schemaVersion", () => {
    // Version 3 ist die erste UNBEKANNTE (2 = aktueller Stand mit Terminen).
    const raw = JSON.stringify({ schemaVersion: 3, entries: [] });
    expect(() => repo.parseBackup(raw)).toThrow("Schema-Version");
  });

  it("akzeptiert eine fehlende schemaVersion defensiv wie Version 1", () => {
    const raw = JSON.stringify({ entries: [] });
    expect(() => repo.parseBackup(raw)).not.toThrow();
  });

  it("wirft bei einem Eintrag ohne gültige id", () => {
    const raw = JSON.stringify({
      entries: [{ id: "", date: "2026-01-15", durationMinutes: 60 }],
    });
    expect(() => repo.parseBackup(raw)).toThrow("keine gültige ID");
  });

  it("wirft bei einem Eintrag mit ungültigem/fehlendem Datum", () => {
    const raw = JSON.stringify({
      entries: [{ id: "e1", date: "15.01.2026", durationMinutes: 60 }],
    });
    expect(() => repo.parseBackup(raw)).toThrow("gültiges Datum");
  });

  it("wirft bei einem Eintrag mit negativer Dauer", () => {
    const raw = JSON.stringify({
      entries: [{ id: "e1", date: "2026-01-15", durationMinutes: -5 }],
    });
    expect(() => repo.parseBackup(raw)).toThrow("ungültige Dauer");
  });

  it("wirft bei einem Eintrag mit nicht-numerischer Dauer", () => {
    const raw = JSON.stringify({
      entries: [{ id: "e1", date: "2026-01-15", durationMinutes: "60" }],
    });
    expect(() => repo.parseBackup(raw)).toThrow("ungültige Dauer");
  });

  it("wirft bei einem Eintrag mit ungültigen tagIds (kein Array)", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "e1", date: "2026-01-15", durationMinutes: 60, tagIds: "t1" },
      ],
    });
    expect(() => repo.parseBackup(raw)).toThrow("Schlagwort-Zuordnungen");
  });

  it("akzeptiert einen Eintrag ohne pauseMinutes (additiv-tolerant, älteres Backup)", () => {
    const raw = JSON.stringify({
      entries: [{ id: "e1", date: "2026-01-15", durationMinutes: 60 }],
    });
    expect(() => repo.parseBackup(raw)).not.toThrow();
  });

  it("akzeptiert einen Eintrag mit gültiger pauseMinutes", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "e1", date: "2026-01-15", durationMinutes: 60, pauseMinutes: 15 },
      ],
    });
    expect(() => repo.parseBackup(raw)).not.toThrow();
  });

  it("wirft bei einem Eintrag mit negativer pauseMinutes", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "e1", date: "2026-01-15", durationMinutes: 60, pauseMinutes: -5 },
      ],
    });
    expect(() => repo.parseBackup(raw)).toThrow("ungültige Pause");
  });

  it("wirft bei einem Eintrag mit nicht-numerischer pauseMinutes", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "e1", date: "2026-01-15", durationMinutes: 60, pauseMinutes: "15" },
      ],
    });
    expect(() => repo.parseBackup(raw)).toThrow("ungültige Pause");
  });
});

describe("getStatsSummary", () => {
  it("aggregiert Monats-/Jahres-/Schlagwort-Summen und schließt Freizeitausgleich aus (Finding 12/14)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN entry_tags et ON et.entry_id = e.id")) {
        return [{ tagId: "t1", label: "BR-Sitzung", minutes: 120 }];
      }
      if (sql.includes("HAVING COUNT(*) > 1")) {
        return [{ minutes: 60 }];
      }
      if (sql.includes("NOT IN (SELECT entry_id FROM entry_tags)")) {
        return [{ minutes: 0 }];
      }
      if (sql.includes("FROM objections o JOIN entries e")) {
        return [{ entryCount: 1, objCount: 2 }];
      }
      if (sql.includes("had_planned_shift = 0")) {
        return [{ minutes: 30 }];
      }
      if (sql.startsWith("SELECT substr(date,1,7) as month")) {
        return [{ month: "2026-01", minutes: 180 }];
      }
      if (sql.startsWith("SELECT substr(date,1,4) as year")) {
        return [{ year: "2026", minutes: 180 }];
      }
      if (sql.startsWith("SELECT SUM(duration_minutes) as minutes FROM entries WHERE")) {
        return [{ minutes: 180 }];
      }
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const summary = await repo.getStatsSummary({});

    expect(summary.totalMinutes).toBe(180);
    expect(summary.monthSums).toEqual([{ month: "2026-01", minutes: 180 }]);
    expect(summary.yearSums).toEqual([{ year: "2026", minutes: 180 }]);
    expect(summary.tagSums).toEqual([
      { tagId: "t1", label: "BR-Sitzung", minutes: 120 },
    ]);
    expect(summary.multiTagMinutes).toBe(60);
    expect(summary.untaggedMinutes).toBe(0);
    expect(summary.outsidePlannedShiftMinutes).toBe(30);
    expect(summary.objectionEntryCount).toBe(1);
    expect(summary.objectionCount).toBe(2);
  });

  it("schließt is_compensation-Einträge aus der Gesamtsumme aus", async () => {
    let sawExclusion = false;
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.includes("is_compensation = 0")) sawExclusion = true;
      if (sql.includes("minutes") && sql.includes("null")) return [];
      return [];
    });
    await repo.getStatsSummary({ from: "2026-01-01", to: "2026-01-31" });
    expect(sawExclusion).toBe(true);
  });

  it("wendet den Von/Bis-Filter auf die Datumsklauseln an", async () => {
    let sawFilter = false;
    selectMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("date >= ?") && (params ?? []).includes("2026-01-01")) {
        sawFilter = true;
      }
      return [];
    });
    await repo.getStatsSummary({ from: "2026-01-01", to: "2026-01-31" });
    expect(sawFilter).toBe(true);
  });
});

describe("getCompensationBalance", () => {
  it("berechnet Guthaben, Verbrauch und Saldo laufend über den Gesamtbestand", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.includes("had_planned_shift = 0 AND is_compensation = 0") && !sql.includes("substr")) {
        return [{ minutes: 300 }]; // Guthaben gesamt
      }
      if (sql.includes("WHERE is_compensation = 1")) {
        return [{ minutes: 120 }]; // Verbrauch gesamt
      }
      if (sql.startsWith("SELECT substr(date,1,7) as month")) {
        return [
          { month: "2026-01", credit: 180, used: 60 },
          { month: "2026-02", credit: 120, used: 60 },
        ];
      }
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const balance = await repo.getCompensationBalance();

    expect(balance.credit).toBe(300);
    expect(balance.used).toBe(120);
    expect(balance.balance).toBe(180);
    expect(balance.byMonth).toEqual([
      { month: "2026-01", credit: 180, used: 60 },
      { month: "2026-02", credit: 120, used: 60 },
    ]);
  });

  it("liefert 0/0/0 ohne Einträge", async () => {
    selectMock.mockResolvedValue([{ minutes: null }]);
    const balance = await repo.getCompensationBalance();
    expect(balance.credit).toBe(0);
    expect(balance.used).toBe(0);
    expect(balance.balance).toBe(0);
  });
});

// Grundlage der lokalen Erinnerung bei fehlender Erfassung (Finding 31).
describe("getLastEntryDate", () => {
  it("liefert das Datum des jüngsten Eintrags", async () => {
    selectMock.mockResolvedValueOnce([{ maxDate: "2026-06-29" }]);
    await expect(repo.getLastEntryDate()).resolves.toBe("2026-06-29");
  });

  it("liefert null ohne Einträge (MAX() auf leerer Tabelle -> NULL)", async () => {
    selectMock.mockResolvedValueOnce([{ maxDate: null }]);
    await expect(repo.getLastEntryDate()).resolves.toBeNull();
  });
});

// ---------- Termine ----------

function baseAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    title: "BR-Sitzung",
    location: "Raum 1",
    description: "Tagesordnung",
    secretDetails: "",
    isAllDay: false,
    startDate: "2026-07-20",
    startTime: "09:00",
    endDate: "2026-07-20",
    endTime: "11:00",
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
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("saveAppointment", () => {
  it("fügt einen neuen Termin samt Schlagwörtern und Erinnerungen atomar ein", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments")) return []; // neu
      if (sql.startsWith("SELECT id, label FROM task_tags"))
        return [{ id: "tag-1", label: "BR-Sitzung" }];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });
    const appt = baseAppointment({
      tagIds: ["tag-1", "tag-verwaist"],
      reminders: [{ id: "rem-1", minutesBefore: 15 }],
    });

    await repo.saveAppointment(appt);

    expect(batchMock).toHaveBeenCalledTimes(1);
    const insert = batchStatement("INSERT INTO appointments");
    expect(insert).toBeDefined();
    // exdates werden als JSON-String geschrieben, updated_at ist der letzte Parameter.
    expect(insert!.params).toContain("[]");
    // Verwaiste Tag-Referenz wird gefiltert (FK-Schutz, wie bei Einträgen).
    const tagInsert = batchStatement("INSERT OR IGNORE INTO appointment_tags");
    expect(tagInsert!.params).toEqual([appt.id, "tag-1"]);
    const remInsert = batchStatement(
      "INSERT OR IGNORE INTO appointment_reminders"
    );
    expect(remInsert!.params).toEqual([("rem-1"), appt.id, 15].flat());
  });

  it("schreibt Erinnerungen DIFF-basiert: unveränderte bleiben unangetastet (kein Doppelfeuer-Risiko)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments"))
        return [{ id: "appt-1" }]; // existiert
      if (sql.startsWith("SELECT id, minutes_before FROM appointment_reminders"))
        return [
          { id: "rem-keep", minutes_before: 15 },
          { id: "rem-change", minutes_before: 30 },
          { id: "rem-drop", minutes_before: 60 },
        ];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });
    const appt = baseAppointment({
      reminders: [
        { id: "rem-keep", minutesBefore: 15 }, // unverändert
        { id: "rem-change", minutesBefore: 45 }, // Vorlauf geändert
        { id: "rem-new", minutesBefore: 5 }, // neu
        // rem-drop fehlt -> wird gelöscht
      ],
    });

    await repo.saveAppointment(appt);

    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    // Kein pauschales DELETE aller Erinnerungen des Termins -- das würde via
    // ON DELETE CASCADE das reminder_fired-Protokoll mitreißen (Risiko 2).
    expect(
      statements.some((s) =>
        s.sql.startsWith("DELETE FROM appointment_reminders WHERE appointment_id")
      )
    ).toBe(false);
    const deletes = statements.filter((s) =>
      s.sql.startsWith("DELETE FROM appointment_reminders WHERE id")
    );
    expect(deletes.map((s) => s.params[0])).toEqual(["rem-drop"]);
    const updates = statements.filter((s) =>
      s.sql.startsWith("UPDATE appointment_reminders")
    );
    expect(updates.map((s) => s.params)).toEqual([[45, "rem-change"]]);
    const inserts = statements.filter((s) =>
      s.sql.startsWith("INSERT OR IGNORE INTO appointment_reminders")
    );
    expect(inserts.map((s) => s.params[0])).toEqual(["rem-new"]);
  });

  it("schreibt für Overrides weder Schlagwörter noch Erinnerungen (erben vom Master)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });
    const override = baseAppointment({
      id: "ov-1",
      parentId: "appt-master",
      recurrenceAnchor: "2026-07-22",
      tagIds: [],
      reminders: [],
    });

    await repo.saveAppointment(override);

    const statements = batchMock.mock.calls[0][0] as { sql: string }[];
    expect(statements.some((s) => s.sql.includes("appointment_tags"))).toBe(false);
    expect(statements.some((s) => s.sql.includes("appointment_reminders"))).toBe(
      false
    );
    expect(statements.some((s) => s.sql.startsWith("INSERT INTO appointments"))).toBe(
      true
    );
  });

  it("berechnet series_end_date für einen Serien-Master und schreibt es in INSERT UND UPDATE", async () => {
    const master = baseAppointment({ rrule: "FREQ=DAILY;UNTIL=20260731" });

    // INSERT-Zweig (neu).
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments")) return []; // neu
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });
    await repo.saveAppointment(master);
    const insert = batchStatement("INSERT INTO appointments");
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("series_end_date");
    // series_end_date steht direkt vor created_at/updated_at (die beiden
    // letzten Params) -- s. appointmentWriteStatements.
    expect(insert!.params[insert!.params.length - 3]).toBe("2026-07-31");

    // UPDATE-Zweig (existiert bereits).
    batchMock.mockClear();
    selectMock.mockReset();
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments")) return [{ id: master.id }];
      if (sql.startsWith("SELECT id, minutes_before FROM appointment_reminders"))
        return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });
    await repo.saveAppointment(master);
    const update = batchStatement("UPDATE appointments SET");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("series_end_date");
    // series_end_date steht direkt vor updated_at/id (die beiden letzten Params).
    expect(update!.params[update!.params.length - 3]).toBe("2026-07-31");
  });

  it("schreibt series_end_date = null für Einzeltermine und Overrides (keine Serien-Master)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM appointments")) return []; // neu
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const single = baseAppointment({ rrule: null });
    await repo.saveAppointment(single);
    const singleInsert = batchStatement("INSERT INTO appointments");
    expect(singleInsert!.params[singleInsert!.params.length - 3]).toBeNull();

    batchMock.mockClear();
    const override = baseAppointment({
      id: "ov-1",
      parentId: "master-1",
      recurrenceAnchor: "2026-07-22",
      // Ein Override trägt NIE ein eigenes Serienende, selbst mit gesetzter
      // RRULE (appt.parentId === null-Bedingung in appointmentWriteStatements).
      rrule: "FREQ=DAILY;UNTIL=20260731",
    });
    await repo.saveAppointment(override);
    const overrideInsert = batchStatement("INSERT INTO appointments");
    expect(overrideInsert!.params[overrideInsert!.params.length - 3]).toBeNull();
  });
});

describe("splitSeries", () => {
  it("migriert das Feuer-Protokoll ab dem Anker auf die neue Serie (kein Doppelfeuern)", async () => {
    // Der Split vergibt neue Termin- UND Reminder-IDs; ohne Migration greift
    // der firedKey (appointmentId|reminderId|anchor) nicht mehr und bereits
    // gezeigte Erinnerungen künftiger Instanzen feuern erneut.
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      if (sql.startsWith("SELECT id, minutes_before FROM appointment_reminders"))
        return [{ id: "rem-old", minutes_before: 10080 }];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    await repo.splitSeries({
      master: baseAppointment({
        id: "master-1",
        rrule: "FREQ=WEEKLY;UNTIL=20260726",
        reminders: [{ id: "rem-old", minutesBefore: 10080 }],
      }),
      newSeries: baseAppointment({
        id: "master-2",
        rrule: "FREQ=WEEKLY",
        startDate: "2026-07-27",
        endDate: "2026-07-27",
        reminders: [{ id: "rem-new", minutesBefore: 10080 }],
      }),
      anchor: "2026-07-27",
    });

    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    const mig = statements.find((s) => s.sql.includes("UPDATE reminder_fired"));
    expect(mig).toBeDefined();
    expect(mig!.params).toEqual([
      "master-2",
      "rem-new",
      "master-1",
      "rem-old",
      "2026-07-27",
    ]);
    // Migration muss NACH dem Anlegen der neuen Erinnerungs-Zeilen laufen
    // (FK reminder_id -> appointment_reminders).
    const migIndex = statements.indexOf(mig!);
    const newRemIndex = statements.findIndex(
      (s) =>
        s.sql.includes("INTO appointment_reminders") &&
        s.params.includes("rem-new")
    );
    expect(newRemIndex).toBeGreaterThanOrEqual(0);
    expect(migIndex).toBeGreaterThan(newRemIndex);
  });
});

describe("listAppointmentsRange", () => {
  it("lädt secret_details in KEINEM Query (strukturelle Vertraulichkeits-Trennung)", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM appointments a")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    await repo.listAppointmentsRange("2026-07-01", "2026-07-31");

    expect(selectMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [sql] of selectMock.mock.calls) {
      expect(sql).not.toContain("secret_details");
    }
  });

  it("lädt Einzeltermine überlappend, Serien-Master bis zum Fensterende und deren Overrides", async () => {
    const queries: string[] = [];
    selectMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes("a.rrule IS NULL AND a.parent_id IS NULL")) {
        // Überlappungsbedingung (start <= to UND end >= from) plus dieselben
        // Fenster-Params für die Override-EXISTS-Bedingung.
        expect(params).toEqual([
          "2026-07-31",
          "2026-07-01",
          "2026-07-31",
          "2026-07-01",
        ]);
        return [];
      }
      if (sql.includes("a.rrule IS NOT NULL")) {
        // Hot-Path-Filter (Issue #4): start_date <= to UND (series_end_date
        // IS NULL ODER series_end_date >= from) -- gleiche Fenster-Params
        // dann nochmal für die Override-EXISTS-Bedingung.
        expect(sql).toContain("a.series_end_date IS NULL OR a.series_end_date >=");
        expect(params).toEqual([
          "2026-07-31",
          "2026-07-01",
          "2026-07-31",
          "2026-07-01",
        ]);
        return [
          {
            id: "master-1",
            title: "Serie",
            location: "",
            description: "",
            is_all_day: 0,
            start_date: "2026-01-07",
            start_time: "09:00",
            end_date: "2026-01-07",
            end_time: "10:00",
            is_important: 0,
            color: null,
            rrule: "FREQ=WEEKLY",
            exdates: "[]",
            parent_id: null,
            recurrence_anchor: null,
            ics_uid: null,
            ics_sequence: 0,
            created_at: "t",
            updated_at: "t",
          },
        ];
      }
      if (sql.includes("a.parent_id IN")) return [];
      if (sql.includes("FROM appointment_tags et JOIN task_tags t")) return [];
      if (sql.startsWith("SELECT id, appointment_id, minutes_before")) return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const items = await repo.listAppointmentsRange("2026-07-01", "2026-07-31");

    expect(items).toHaveLength(1);
    expect(items[0].rrule).toBe("FREQ=WEEKLY");
    expect(items[0].exdates).toEqual([]);
    // Overrides der geladenen Master wurden abgefragt.
    expect(queries.some((q) => q.includes("a.parent_id IN"))).toBe(true);
  });

  it("findet Master über vorgezogene Overrides auch in Fenstern vor dem Serien-/Terminstart", async () => {
    // Eine Instanz vom 05.08. wurde per "nur dieser Termin" auf den 15.07.
    // verlegt (Serie startet 01.08.): Die Master-Auswahl darf nicht allein an
    // den Master-Daten hängen, sonst ist der Override im Juli nirgends sichtbar.
    let masterSql = "";
    let masterParams: unknown[] = [];
    let singleSql = "";
    let singleParams: unknown[] = [];
    selectMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("a.rrule IS NOT NULL")) {
        masterSql = sql;
        masterParams = params ?? [];
        return [];
      }
      if (sql.includes("a.rrule IS NULL AND a.parent_id IS NULL")) {
        singleSql = sql;
        singleParams = params ?? [];
        return [];
      }
      return [];
    });

    await repo.listAppointmentsRange("2026-07-01", "2026-07-31");

    expect(masterSql).toMatch(/EXISTS/);
    expect(masterSql).toContain("a.series_end_date IS NULL OR a.series_end_date >=");
    expect(masterParams).toEqual([
      "2026-07-31",
      "2026-07-01",
      "2026-07-31",
      "2026-07-01",
    ]);
    // Auch Master OHNE Serienregel können Override-Kinder haben (Serie auf
    // "Nie" gestellt) -- dieselbe Existenz-Bedingung.
    expect(singleSql).toMatch(/EXISTS/);
    expect(singleParams).toEqual([
      "2026-07-31",
      "2026-07-01",
      "2026-07-31",
      "2026-07-01",
    ]);
  });
});

describe("backfillSeriesEndDates", () => {
  it("aktualisiert nur Serien mit ermittelbarem Ende (COUNT/UNTIL) -- endlose Serien bleiben unangetastet", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (
        sql.startsWith(
          "SELECT id, rrule, start_date, end_date, start_time, is_all_day"
        )
      ) {
        return [
          {
            id: "count-serie",
            rrule: "FREQ=WEEKLY;COUNT=3",
            start_date: "2026-07-01",
            end_date: "2026-07-01",
            start_time: "09:00",
            is_all_day: 0,
          },
          {
            id: "endlose-serie",
            rrule: "FREQ=DAILY",
            start_date: "2026-07-01",
            end_date: "2026-07-01",
            start_time: "09:00",
            is_all_day: 0,
          },
        ];
      }
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    await repo.backfillSeriesEndDates();

    expect(batchMock).toHaveBeenCalledTimes(1);
    const updates = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toBe(
      "UPDATE appointments SET series_end_date = ? WHERE id = ?"
    );
    expect(updates[0].params).toEqual(["2026-07-15", "count-serie"]);
  });

  it("ruft db.batch bei leerem Ergebnis nicht auf", async () => {
    selectMock.mockResolvedValueOnce([]);

    await repo.backfillSeriesEndDates();

    expect(batchMock).not.toHaveBeenCalled();
  });
});

describe("Backup mit Terminen (schemaVersion 2)", () => {
  it("applyImport schreibt Termine mit Original-updated_at und übernimmt nur gültige Feuer-Markierungen", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return [];
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      if (sql.startsWith("SELECT id, appointment_id, minutes_before")) return [];
      if (sql.startsWith("SELECT id, updated_at FROM appointments")) return [];
      if (sql.startsWith("SELECT id, parent_id, recurrence_anchor, updated_at"))
        return [];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const importedUpdatedAt = "2026-07-02T09:00:00.000Z";
    const payload: BackupPayload = {
      schemaVersion: 2,
      exportedAt: "2026-07-18T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [],
      appointments: [
        baseAppointment({
          updatedAt: importedUpdatedAt,
          reminders: [{ id: "rem-1", minutesBefore: 15 }],
        }),
      ],
      reminderFired: [
        {
          appointmentId: "appt-1",
          reminderId: "rem-1",
          occurrenceAnchor: "2026-07-20",
          firedAt: "2026-07-20T08:45:00.000Z",
        },
        {
          // Verwaiste Markierung (unbekannte Erinnerung) -> still übersprungen,
          // sonst bricht die FK-Prüfung die gesamte Import-Transaktion ab.
          appointmentId: "appt-1",
          reminderId: "rem-ghost",
          occurrenceAnchor: "2026-07-20",
          firedAt: "2026-07-20T08:45:00.000Z",
        },
      ],
    };

    await repo.applyImport(payload);

    expect(batchMock).toHaveBeenCalledTimes(1);
    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    const insert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO appointments")
    );
    expect(insert).toBeDefined();
    // Letzter Parameter ist updated_at -- Original erhalten (Finding 10).
    expect(insert!.params[insert!.params.length - 1]).toBe(importedUpdatedAt);
    const firedInserts = statements.filter((s) =>
      s.sql.includes("INTO reminder_fired")
    );
    expect(firedInserts).toHaveLength(1);
    expect(firedInserts[0].params[1]).toBe("rem-1");
  });

  it("löst Override-Kollisionen am selben Anker per Last-Writer-Wins statt UNIQUE-Crash", async () => {
    // Zwei Geräte haben dieselbe Instanz unabhängig bearbeitet: lokal ov-local,
    // im Payload ov-remote -- beide (parent_id=master-1, anchor=2026-07-27).
    // Ein plain INSERT würde am UNIQUE-Index scheitern und den ganzen Import abbrechen.
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return [];
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      if (sql.startsWith("SELECT id, appointment_id, minutes_before")) return [];
      if (sql.startsWith("SELECT id, updated_at FROM appointments"))
        return [
          { id: "master-1", updated_at: "2026-07-01T00:00:00.000Z" },
          { id: "ov-local", updated_at: "2026-07-01T00:00:00.000Z" },
        ];
      if (sql.startsWith("SELECT id, parent_id, recurrence_anchor, updated_at"))
        return [
          {
            id: "ov-local",
            parent_id: "master-1",
            recurrence_anchor: "2026-07-27",
            updated_at: "2026-07-01T00:00:00.000Z",
          },
        ];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 2,
      exportedAt: "2026-07-18T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [],
      appointments: [
        baseAppointment({
          id: "ov-remote",
          parentId: "master-1",
          recurrenceAnchor: "2026-07-27",
          updatedAt: "2026-07-05T00:00:00.000Z", // neuer als ov-local -> gewinnt
        }),
      ],
    };
    await repo.applyImport(payload);

    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    expect(
      statements.some(
        (s) =>
          s.sql.startsWith("DELETE FROM appointments WHERE id = ?") &&
          s.params[0] === "ov-local"
      )
    ).toBe(true);
    expect(
      statements.some(
        (s) =>
          s.sql.startsWith("INSERT INTO appointments") &&
          s.params[0] === "ov-remote"
      )
    ).toBe(true);
  });

  it("überspringt einen Payload-Override, wenn der lokale am selben Anker neuer ist", async () => {
    selectMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id, updated_at FROM entries")) return [];
      if (sql.startsWith("SELECT id, label FROM task_tags")) return [];
      if (sql.startsWith("SELECT id, appointment_id, minutes_before")) return [];
      if (sql.startsWith("SELECT id, updated_at FROM appointments"))
        return [
          { id: "master-1", updated_at: "2026-07-01T00:00:00.000Z" },
          { id: "ov-local", updated_at: "2026-07-10T00:00:00.000Z" },
        ];
      if (sql.startsWith("SELECT id, parent_id, recurrence_anchor, updated_at"))
        return [
          {
            id: "ov-local",
            parent_id: "master-1",
            recurrence_anchor: "2026-07-27",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ];
      throw new Error(`Unerwartete Query im Test: ${sql}`);
    });

    const payload: BackupPayload = {
      schemaVersion: 2,
      exportedAt: "2026-07-18T00:00:00.000Z",
      app: "BR-Log",
      tags: [],
      entries: [],
      appointments: [
        baseAppointment({
          id: "ov-remote",
          parentId: "master-1",
          recurrenceAnchor: "2026-07-27",
          updatedAt: "2026-07-05T00:00:00.000Z", // älter als ov-local -> verliert
        }),
      ],
    };
    await repo.applyImport(payload);

    const statements = batchMock.mock.calls[0][0] as {
      sql: string;
      params: unknown[];
    }[];
    expect(
      statements.some((s) => s.sql.startsWith("INSERT INTO appointments"))
    ).toBe(false);
    expect(
      statements.some((s) =>
        s.sql.startsWith("DELETE FROM appointments WHERE id = ?")
      )
    ).toBe(false);
  });

  it("parseBackup lehnt kaputte Termine mit konkreter Meldung ab", () => {
    const allDayMitUhrzeit = JSON.stringify({
      schemaVersion: 2,
      entries: [],
      appointments: [
        {
          id: "a1",
          startDate: "2026-07-20",
          endDate: "2026-07-20",
          isAllDay: true,
          startTime: "09:00",
        },
      ],
    });
    expect(() => repo.parseBackup(allDayMitUhrzeit)).toThrow(
      "darf keine Uhrzeiten"
    );

    // Invertierte Zeiten am selben Tag: kein DB-CHECK prüft die Reihenfolge --
    // die Validierung muss die negative Dauer VOR dem Schreiben ablehnen.
    const zeitInvertiert = JSON.stringify({
      schemaVersion: 2,
      entries: [],
      appointments: [
        {
          id: "a3",
          startDate: "2026-07-20",
          startTime: "14:00",
          endDate: "2026-07-20",
          endTime: "13:00",
        },
      ],
    });
    expect(() => repo.parseBackup(zeitInvertiert)).toThrow(
      "endet vor seinem Beginn"
    );

    const overrideOhneAnker = JSON.stringify({
      schemaVersion: 2,
      entries: [],
      appointments: [
        {
          id: "a2",
          startDate: "2026-07-20",
          startTime: "09:00",
          endDate: "2026-07-20",
          endTime: "10:00",
          parentId: "master-1",
        },
      ],
    });
    expect(() => repo.parseBackup(overrideOhneAnker)).toThrow("Instanz-Anker");
  });

  it("parseBackup akzeptiert v1-Backups ohne appointments unverändert", () => {
    const raw = JSON.stringify({ schemaVersion: 1, entries: [] });
    const result = repo.parseBackup(raw);
    expect(result.appointments).toBeUndefined();
  });
});
