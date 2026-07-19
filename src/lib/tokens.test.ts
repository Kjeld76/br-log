import { describe, expect, it } from "vitest";
import { FOUC_BG, PRINT } from "./tokens";

describe("tokens", () => {
  it("FOUC-Farben entsprechen den tokens.css-Hintergründen", () => {
    expect(FOUC_BG.light).toBe("#f8fafc");
    expect(FOUC_BG.dark).toBe("#0f172a");
  });
  it("Print-Farben sind definiert (PDF ist immer Papier)", () => {
    expect(PRINT.ink).toBe("#000000");
    expect(PRINT.paper).toBe("#ffffff");
  });
});
