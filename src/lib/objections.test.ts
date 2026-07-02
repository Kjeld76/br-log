import { describe, expect, it } from "vitest";
import { formatObjectionMeta } from "./objections";

describe("formatObjectionMeta", () => {
  it("joint byWhom und date mit dem übergebenen Separator", () => {
    const o = { id: "1", reason: "Grund", byWhom: "GL", date: "2026-01-15" };
    expect(formatObjectionMeta(o, " · ")).toBe("GL · 2026-01-15");
    expect(formatObjectionMeta(o, ", ")).toBe("GL, 2026-01-15");
  });

  it("lässt fehlende Teile weg statt eines leeren Segments", () => {
    expect(
      formatObjectionMeta({ id: "1", reason: "x", byWhom: "GL", date: null }, " · ")
    ).toBe("GL");
    expect(
      formatObjectionMeta({ id: "1", reason: "x", byWhom: "", date: "2026-01-15" }, " · ")
    ).toBe("2026-01-15");
  });

  it("liefert einen leeren String ohne byWhom/date", () => {
    expect(
      formatObjectionMeta({ id: "1", reason: "x", byWhom: "", date: null }, " · ")
    ).toBe("");
  });
});
