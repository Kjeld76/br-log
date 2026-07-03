import { beforeEach, describe, expect, it, vi } from "vitest";

// Linux-Portierung: Die Dialog-Aufrufe (@tauri-apps/plugin-dialog) sind aus
// dem Frontend verschwunden -- Speichern-/Öffnen-Dialog laufen jetzt komplett
// auf der Rust-Seite (file_io.rs), das Frontend ruft nur noch die Commands
// export_text_file/export_binary_file/import_text_file per invoke() auf.
// Entsprechend wird hier "@tauri-apps/api/core" gemockt statt eines
// Dialog-Mocks (Teststil wie repository.test.ts: Abhängigkeit mocken, Logik
// von exporters.ts gegen den Mock testen).
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const getAllForBackupMock = vi.fn();
const parseBackupMock = vi.fn();
const listEntriesMock = vi.fn();
const listEntriesFullMock = vi.fn();
vi.mock("../db/repository", () => ({
  listEntries: (...args: unknown[]) => listEntriesMock(...args),
  listEntriesFull: (...args: unknown[]) => listEntriesFullMock(...args),
  getAllForBackup: (...args: unknown[]) => getAllForBackupMock(...args),
  parseBackup: (...args: unknown[]) => parseBackupMock(...args),
}));

const exporters = await import("./exporters");

beforeEach(() => {
  invokeMock.mockReset();
  getAllForBackupMock.mockReset();
  parseBackupMock.mockReset();
  listEntriesMock.mockReset();
  listEntriesFullMock.mockReset();
  listEntriesMock.mockResolvedValue([]);
  listEntriesFullMock.mockResolvedValue([]);
});

describe("exportJsonBackup", () => {
  it("ruft export_text_file mit defaultName/filterName/extension/contents auf und liefert den Anzeige-Pfad zurück", async () => {
    getAllForBackupMock.mockResolvedValue({ entries: [], tags: [] });
    invokeMock.mockResolvedValue("C:\\Users\\test\\BR-Log_Backup.json");

    const path = await exporters.exportJsonBackup();

    expect(path).toBe("C:\\Users\\test\\BR-Log_Backup.json");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe("export_text_file");
    expect(args.filterName).toBe("JSON");
    expect(args.extension).toBe("json");
    expect(typeof args.defaultName).toBe("string");
    expect(typeof args.contents).toBe("string");
  });

  it("liefert null bei Nutzer-Abbruch, ohne das als Fehler zu behandeln", async () => {
    getAllForBackupMock.mockResolvedValue({ entries: [], tags: [] });
    invokeMock.mockResolvedValue(null);

    const path = await exporters.exportJsonBackup();

    expect(path).toBeNull();
  });
});

describe("exportGlCsv", () => {
  it("ruft export_text_file mit CSV-Filter auf", async () => {
    invokeMock.mockResolvedValue("/home/mario/BR-Log_GL.csv");

    const path = await exporters.exportGlCsv();

    expect(path).toBe("/home/mario/BR-Log_GL.csv");
    const [command, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe("export_text_file");
    expect(args.filterName).toBe("CSV");
    expect(args.extension).toBe("csv");
  });
});

describe("pickAndReadBackup", () => {
  it("liefert null bei Abbruch, ohne parseBackup aufzurufen", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await exporters.pickAndReadBackup();

    expect(result).toBeNull();
    expect(parseBackupMock).not.toHaveBeenCalled();
  });

  it("ruft import_text_file mit JSON-Filter auf und parst den gelieferten Inhalt", async () => {
    invokeMock.mockResolvedValue({ name: "backup.json", contents: '{"foo":1}' });
    parseBackupMock.mockReturnValue({ foo: 1 });

    const result = await exporters.pickAndReadBackup();

    expect(invokeMock).toHaveBeenCalledWith("import_text_file", {
      filterName: "JSON",
      extension: "json",
    });
    expect(parseBackupMock).toHaveBeenCalledWith('{"foo":1}');
    expect(result).toEqual({ foo: 1 });
  });
});
