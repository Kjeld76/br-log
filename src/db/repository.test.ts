import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupPayload, TimeEntry } from "../types";

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
      .mockResolvedValueOnce([{ entry_id: "entry-1" }]) // public_content-Treffer
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
    const raw = JSON.stringify({ schemaVersion: 2, entries: [] });
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
});
