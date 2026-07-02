import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupPayload, TimeEntry } from "../types";

// DB-Schicht komplett mocken (austauschbare Schicht, siehe client.ts) -> die
// repository.ts-Logik wird gegen den Mock getestet, ohne echtes SQLite/Tauri.
const selectMock = vi.fn();
const executeMock = vi.fn();
const isFtsAvailableMock = vi.fn();

vi.mock("./client", () => ({
  getDb: vi.fn(async () => ({ select: selectMock, execute: executeMock })),
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
  isFtsAvailableMock.mockReset();
  isFtsAvailableMock.mockReturnValue(false); // FTS-Pflege ist nicht Gegenstand dieser Tests
  executeMock.mockResolvedValue(0);
});

describe("saveEntry", () => {
  it("fügt einen neuen Eintrag ein (INSERT), wenn die ID noch nicht existiert", async () => {
    selectMock.mockResolvedValueOnce([]); // "SELECT id FROM entries WHERE id = ?" -> nicht vorhanden
    const entry = baseEntry({ tagIds: ["tag-1"] });

    await repo.saveEntry(entry);

    const insertCall = executeMock.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT INTO entries")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      entry.id,
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.durationMinutes,
      entry.infoForManagement,
      entry.secretDetails,
      1, // hadPlannedShift: true -> 1
      entry.shiftCompensationNote,
      entry.createdAt,
      expect.any(String), // now
    ]);

    // Tags neu gesetzt: erst löschen, dann pro Tag einfügen.
    const tagDelete = executeMock.mock.calls.find(([sql]) =>
      String(sql).startsWith("DELETE FROM entry_tags")
    );
    expect(tagDelete![1]).toEqual([entry.id]);
    const tagInsert = executeMock.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT OR IGNORE INTO entry_tags")
    );
    expect(tagInsert![1]).toEqual([entry.id, "tag-1"]);
  });

  it("aktualisiert einen bestehenden Eintrag (UPDATE), wenn die ID schon existiert", async () => {
    selectMock.mockResolvedValueOnce([{ id: "entry-1" }]); // existiert bereits
    const entry = baseEntry();

    await repo.saveEntry(entry);

    const updateCall = executeMock.mock.calls.find(([sql]) =>
      String(sql).startsWith("UPDATE entries SET")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.durationMinutes,
      entry.infoForManagement,
      entry.secretDetails,
      1,
      entry.shiftCompensationNote,
      expect.any(String), // now
      entry.id,
    ]);
    const insertCall = executeMock.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT INTO entries")
    );
    expect(insertCall).toBeUndefined();
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

    const objectionInserts = executeMock.mock.calls.filter(([sql]) =>
      String(sql).startsWith("INSERT INTO objections")
    );
    expect(objectionInserts).toHaveLength(1);
    expect(objectionInserts[0][1][1]).toBe(entry.id);
    expect(objectionInserts[0][1][2]).toBe("Grund");
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
      if (sql.startsWith("SELECT id FROM task_tags")) {
        return [{ id: "tag-existing" }];
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
});
