import { describe, expect, it } from "vitest";
import { formatObjectionMeta } from "./objections";

describe("formatObjectionMeta", () => {
  it("joint byWhom und date mit dem übergebenen Separator", () => {
    const o = { id: "1", reason: "Grund", byWhom: "GL", date: "2026-01-15" };
    expect(formatObjectionMeta(o, " · ")).toBe("GL · 2026-01-15");
    expect(formatObjectionMeta(o, ", ")).toBe("GL, 2026-01-15");
  });

  it("lässt fehlende Teile weg statt eines leeren Segments", () => {
    const withoutDate = { id: "1", reason: "x", byWhom: "GL", date: null };
    const withoutByWhom = { id: "1", reason: "x", byWhom: "", date: "2026-01-15" };
    expect(formatObjectionMeta(withoutDate, " · ")).toBe("GL");
    expect(formatObjectionMeta(withoutByWhom, " · ")).toBe("2026-01-15");
  });

  it("liefert einen leeren String ohne byWhom/date", () => {
    const empty = { id: "1", reason: "x", byWhom: "", date: null };
    expect(formatObjectionMeta(empty, " · ")).toBe("");
  });
});
