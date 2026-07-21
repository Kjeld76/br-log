import { describe, expect, it } from "vitest";
import { clearModalDraft, saveModalDraft, takeModalDraft } from "./modalDraftStore";

// Reiner RAM-Store für den Formular-Entwurf des offenen Bearbeiten-Modals
// beim Sperren (Issue #17, Task 9) -- s. Doc-Kommentar in modalDraftStore.ts
// für die Abwägung (überlebt Sperren/Entsperren, NICHT den App-Neustart).
// take*-Semantik ist der eigentliche Vertrag: GENAU EIN Abruf pro Sicherung.
describe("modalDraftStore", () => {
  it("liefert per takeModalDraft genau den zuvor gesicherten Draft", () => {
    const draft = { type: "form", entry: { id: "1", infoForManagement: "x" } };
    saveModalDraft(draft);
    expect(takeModalDraft()).toEqual(draft);
  });

  it("liefert beim zweiten Abruf null (take entfernt den Draft aus dem Store)", () => {
    saveModalDraft({ foo: "bar" });
    takeModalDraft();
    expect(takeModalDraft()).toBeNull();
  });

  it("liefert null, wenn nie etwas gesichert wurde bzw. nach clearModalDraft", () => {
    clearModalDraft();
    expect(takeModalDraft()).toBeNull();
  });

  it("clearModalDraft verwirft einen gesicherten Draft explizit, ohne ihn zurückzugeben", () => {
    saveModalDraft({ secretDetails: "vertraulich" });
    clearModalDraft();
    expect(takeModalDraft()).toBeNull();
  });

  it("saveModalDraft überschreibt einen vorher gesicherten, noch nicht abgeholten Draft", () => {
    saveModalDraft({ version: 1 });
    saveModalDraft({ version: 2 });
    expect(takeModalDraft()).toEqual({ version: 2 });
  });
});
