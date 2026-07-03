import { afterEach, describe, expect, it, vi } from "vitest";

// @tauri-apps/plugin-os wird gemockt, damit platform.ts (die einzige Stelle,
// die die echte platform()-Funktion aufruft) unabhängig von einer echten
// Tauri-Webview testbar ist -- siehe Kommentar in platform.ts.
const platformMock = vi.fn();
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => platformMock(),
}));

const { isAndroid, isDesktop, isLinux, isWindows } = await import("./platform");

afterEach(() => {
  platformMock.mockReset();
});

describe("platform", () => {
  it("erkennt Windows und wertet es als Desktop", () => {
    platformMock.mockReturnValue("windows");
    expect(isWindows()).toBe(true);
    expect(isLinux()).toBe(false);
    expect(isAndroid()).toBe(false);
    expect(isDesktop()).toBe(true);
  });

  it("erkennt Linux und wertet es als Desktop", () => {
    platformMock.mockReturnValue("linux");
    expect(isLinux()).toBe(true);
    expect(isWindows()).toBe(false);
    expect(isDesktop()).toBe(true);
  });

  it("erkennt Android und wertet es NICHT als Desktop", () => {
    platformMock.mockReturnValue("android");
    expect(isAndroid()).toBe(true);
    expect(isWindows()).toBe(false);
    expect(isLinux()).toBe(false);
    expect(isDesktop()).toBe(false);
  });

  it("fällt in einer Nicht-Tauri-Umgebung (platform() wirft) auf windows zurück", () => {
    platformMock.mockImplementation(() => {
      throw new TypeError("window.__TAURI_OS_PLUGIN_INTERNALS__ is undefined");
    });
    expect(isWindows()).toBe(true);
    expect(isDesktop()).toBe(true);
  });
});
