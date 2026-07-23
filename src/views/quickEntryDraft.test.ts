import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntry } from "../types";

// Sicherheits-Fix Issue #35: Der Erfassen-Entwurf hielt secretDetails (das
// BR-Geheimnis) im Klartext im localStorage -- localStorage liegt
// unverschlüsselt im WebView-Profil, außerhalb der SQLCipher-DB. Diese Tests
// belegen die Hybrid-Lösung (analog dem Modal-Draft-Store aus Issue #17/
// Task 9, s. lib/modalDraftStore.ts): unkritische Felder bleiben wie bisher
// auf der Platte (Komfort über einen App-Neustart hinweg), secretDetails
// NUR im RAM (Modul-Variable -- übersteht Sperren/Entsperren und
// Tab-Wechsel, weil der Prozess dabei weiterläuft, aber bewusst NICHT einen
// echten App-Neustart).
//
// Jeder Testfall importiert das Modul frisch (vi.resetModules() +
// dynamischer re-import, Muster lib/auth.test.ts) -- sonst würde das
// RAM-Geheimnis (`ramSecret`) eines Tests in den nächsten durchschlagen.
// localStorage existiert unter Vitest-environment "node" nicht global; ein
// simpler In-Memory-Shim (vi.stubGlobal) deckt den hier gebrauchten
// Ausschnitt der Storage-API ab.

const DRAFT_KEY = "brlog.quickEntryDraft";

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", stub);
}

function makeEntry(id: string, secretDetails: string): TimeEntry {
  return {
    id,
    date: "2026-07-23",
    startTime: null,
    endTime: null,
    durationMinutes: 60,
    pauseMinutes: 0,
    infoForManagement: `Info ${id}`,
    secretDetails,
    hadPlannedShift: true,
    shiftCompensationNote: "",
    isCompensation: false,
    tagIds: [],
    objections: [],
    createdAt: "2026-07-23T08:00:00.000Z",
    updatedAt: "2026-07-23T08:00:00.000Z",
  };
}

describe("quickEntryDraft (Issue #35: secretDetails nie im Klartext auf Platte)", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Canary Platte: saveDraft schreibt secretDetails NIE in den localStorage-Rohstring, loadDraft liefert es trotzdem (aus RAM)", async () => {
    const { saveDraft, loadDraft } = await import("./quickEntryDraft");
    const entry = makeEntry("e1", "VERTRAULICH_CANARY_35");

    saveDraft(entry);

    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("VERTRAULICH_CANARY_35");

    const loaded = loadDraft();
    expect(loaded?.secretDetails).toBe("VERTRAULICH_CANARY_35");
    expect(loaded?.infoForManagement).toBe(entry.infoForManagement); // unkritische Felder round-trippen weiter
  });

  it("Scrub-Migration: ein Alt-Leak (secretDetails vor diesem Fix auf Platte) wird beim ersten loadDraft ins RAM übernommen UND von der Platte entfernt", async () => {
    const leaked = makeEntry("e2", "ALT_LECK_CANARY");
    localStorage.setItem(DRAFT_KEY, JSON.stringify(leaked));
    const { loadDraft } = await import("./quickEntryDraft");

    const loaded = loadDraft();
    expect(loaded?.secretDetails).toBe("ALT_LECK_CANARY");

    const rawAfter = localStorage.getItem(DRAFT_KEY);
    expect(rawAfter).not.toContain("ALT_LECK_CANARY");
    expect(JSON.parse(rawAfter!).secretDetails).toBe("");
  });

  it("Neustart-Simulation: nach Prozessende (RAM weg, localStorage bleibt) ist secretDetails leer, unkritische Felder bleiben erhalten", async () => {
    const { saveDraft } = await import("./quickEntryDraft");
    saveDraft(makeEntry("e3", "WIRD_VERGESSEN"));

    // "Neustart": frisches Modul (ramSecret = null durch Modul-Neuinstanz),
    // localStorage-Stub bleibt UNVERÄNDERT bestehen (kein erneutes
    // installLocalStorageStub()) -- genau das simuliert einen Prozess-Neustart.
    vi.resetModules();
    const { loadDraft } = await import("./quickEntryDraft");

    const loaded = loadDraft();
    expect(loaded?.secretDetails).toBe("");
    expect(loaded?.infoForManagement).toBe("Info e3");
  });

  it("id-Entkopplung: ein RAM-Geheimnis einer anderen id wird nicht über einen fremden Draft gelegt", async () => {
    const { saveDraft, loadDraft } = await import("./quickEntryDraft");
    saveDraft(makeEntry("A", "GEHEIMNIS_A"));

    // Draft mit ANDERER id landet auf der Platte, ohne über saveDraft("B")
    // zu laufen (z. B. weil "A"s Geheimnis noch nicht abgeholt wurde).
    localStorage.setItem(DRAFT_KEY, JSON.stringify(makeEntry("B", "")));

    const loaded = loadDraft();
    expect(loaded?.id).toBe("B");
    expect(loaded?.secretDetails).toBe("");
  });

  it("clearQuickEntryDraft entfernt localStorage UND das RAM-Geheimnis", async () => {
    const { saveDraft, loadDraft, clearQuickEntryDraft } = await import("./quickEntryDraft");
    saveDraft(makeEntry("e5", "WEG_DAMIT"));

    clearQuickEntryDraft();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(loadDraft()).toBeNull();
  });
});
