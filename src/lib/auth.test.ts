import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auto-Lock-Konfiguration (Issue #17, Task 5): Sentinel 0 = "nie automatisch
// sperren". startIdleTimer(0, ...) muss ein ECHTES No-op sein (kein Timer,
// keine Aktivitäts-Listener), nicht nur ein Timer, der irgendwann feuert.
// getAutoLockMinutes/setAutoLockMinutes laufen über invoke() (Rust-Backend)
// -- wie exporters.test.ts gemockt, statt einer echten Tauri-Webview.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Für startIdleTimer genügt ein einmaliger Modul-Import: die Funktion hat
// keinen eigenen Modul-Zustand. getAutoLockMinutes/setAutoLockMinutes hängen
// dagegen am modulinternen statusCache (getStartStatus) -- die zugehörigen
// Tests importieren das Modul deshalb je Fall frisch (vi.resetModules() +
// dynamischer re-import), damit ein gecachter db_status aus einem früheren
// Test nicht in den nächsten durchschlägt.
const { startIdleTimer } = await import("./auth");

// startIdleTimer arbeitet direkt mit window.setTimeout/clearTimeout/
// addEventListener/removeEventListener. Das Projekt testet bewusst mit
// Vitest-environment "node" (vitest.config.ts, s. Kommentar dort und in
// reminderOrchestrator.ts) statt jsdom/happy-dom als Abhängigkeit
// einzuführen -- ein `window`-Stub auf Basis des in Node bereits global
// verfügbaren `EventTarget` reicht hier aus (echte addEventListener/
// removeEventListener/dispatchEvent-Semantik, keine neue Abhängigkeit).
function installWindowStub() {
  const win = new EventTarget() as EventTarget & {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  vi.stubGlobal("window", win);
  return win;
}

describe("startIdleTimer", () => {
  beforeEach(() => {
    // Reihenfolge wichtig: erst Fake-Timer aktivieren, DANN den window-Stub
    // bauen -- sonst fängt `win.setTimeout = setTimeout` noch die echte
    // (ungefakte) Funktionsreferenz ein, und vi.advanceTimersByTime bewegt
    // nie einen echten Timer.
    vi.useFakeTimers();
    installWindowStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("startet bei Sentinel 0 KEINEN Timer -- onLock wird auch nach sehr langer Zeit nie aufgerufen", () => {
    const onLock = vi.fn();
    const stop = startIdleTimer(0, onLock);

    vi.advanceTimersByTime(24 * 60 * 60_000); // 24 Stunden

    expect(onLock).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("registriert bei Sentinel 0 keine Aktivitäts-Listener (echtes No-op, nicht nur ein nie feuernder Timer)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const stop = startIdleTimer(0, vi.fn());

    expect(addSpy).not.toHaveBeenCalled();
    stop();
  });

  it("gibt bei Sentinel 0 trotzdem eine funktionierende Cleanup-Funktion zurück", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const stop = startIdleTimer(0, vi.fn());

    expect(() => stop()).not.toThrow();
    // Kein Listener registriert -> auch keiner zu entfernen.
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("ruft onLock nach Ablauf positiver Minuten ohne Aktivität auf (unverändertes Bestandsverhalten)", () => {
    const onLock = vi.fn();
    const stop = startIdleTimer(5, onLock);

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("setzt den Timer bei Aktivität zurück statt zu sperren (unverändertes Bestandsverhalten)", () => {
    const onLock = vi.fn();
    const stop = startIdleTimer(5, onLock);

    vi.advanceTimersByTime(4 * 60_000);
    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(4 * 60_000); // 8 min seit Start, aber nur 4 min seit Reset

    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000 + 1); // > 5 min seit dem Reset
    expect(onLock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("entfernt Timer und Listener beim Aufruf der Cleanup-Funktion", () => {
    const onLock = vi.fn();
    const stop = startIdleTimer(1, onLock);

    stop();
    vi.advanceTimersByTime(10 * 60_000);

    expect(onLock).not.toHaveBeenCalled();
  });
});

describe("getAutoLockMinutes / setAutoLockMinutes (Clamp inkl. Sentinel 0)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('gibt den Sentinel 0 ("nie") von db_status unverändert durch', async () => {
    vi.resetModules();
    invokeMock.mockResolvedValueOnce({ mode: "encrypted", autoLockMinutes: 0 });
    const { getAutoLockMinutes } = await import("./auth");

    await expect(getAutoLockMinutes()).resolves.toBe(0);
  });

  it("lässt Bestandswerte bis 120 unverändert durch (Rust toleriert sie, auch wenn neue UI-Eingaben auf 1-60 begrenzt sind)", async () => {
    vi.resetModules();
    invokeMock.mockResolvedValueOnce({ mode: "encrypted", autoLockMinutes: 120 });
    const { getAutoLockMinutes } = await import("./auth");

    await expect(getAutoLockMinutes()).resolves.toBe(120);
  });

  it("fällt bei einem ungültigen Wert auf den Default 5 zurück", async () => {
    vi.resetModules();
    invokeMock.mockResolvedValueOnce({ mode: "encrypted", autoLockMinutes: 999 });
    const { getAutoLockMinutes } = await import("./auth");

    await expect(getAutoLockMinutes()).resolves.toBe(5);
  });

  it("setAutoLockMinutes(0) sendet den Sentinel unverändert an crypto_set_autolock", async () => {
    vi.resetModules();
    invokeMock.mockResolvedValue(undefined);
    const { setAutoLockMinutes } = await import("./auth");

    await setAutoLockMinutes(0);

    expect(invokeMock).toHaveBeenCalledWith("crypto_set_autolock", { minutes: 0 });
  });

  it("setAutoLockMinutes klemmt Werte über 120 auf 120 (Bestandsverhalten)", async () => {
    vi.resetModules();
    invokeMock.mockResolvedValue(undefined);
    const { setAutoLockMinutes } = await import("./auth");

    await setAutoLockMinutes(500);

    expect(invokeMock).toHaveBeenCalledWith("crypto_set_autolock", { minutes: 120 });
  });

  it("setAutoLockMinutes klemmt Werte unter 1 (aber über 0) auf 1 -- ein Rundungsartefakt darf nicht zu 'nie' werden", async () => {
    vi.resetModules();
    invokeMock.mockResolvedValue(undefined);
    const { setAutoLockMinutes } = await import("./auth");

    await setAutoLockMinutes(0.4);

    expect(invokeMock).toHaveBeenCalledWith("crypto_set_autolock", { minutes: 1 });
  });
});
