import { describe, expect, it } from "vitest";
import { toUserMessage } from "./errors";

describe("toUserMessage", () => {
  it("übersetzt 'database is locked' in eine deutsche Meldung mit Handlungsempfehlung", () => {
    const msg = toUserMessage(new Error("error returned from database: (code: 5) database is locked"));
    expect(msg).toContain("gesperrt");
    expect(msg).toContain("erneut versuchen");
    // Technisches Detail bleibt für den Support-Fall erhalten.
    expect(msg).toContain("database is locked");
  });

  it("übersetzt Speicherplatz-Fehler", () => {
    const msg = toUserMessage(new Error("No space left on device (disk full)"));
    expect(msg).toContain("Speicherplatz");
  });

  it("übersetzt Entschlüsselungsfehler", () => {
    const msg = toUserMessage("DB nicht entschlüsselbar: file is not a database");
    expect(msg).toContain("entschlüsseln");
  });

  it("liefert eine generische deutsche Meldung für unbekannte Fehler, technisches Detail bleibt erhalten", () => {
    const msg = toUserMessage(new Error("some completely unknown low-level error xyz123"));
    expect(msg).toContain("unerwarteter Fehler");
    expect(msg).toContain("xyz123");
  });

  it("funktioniert auch mit reinen String-Fehlern (Tauri-IPC liefert oft keinen Error)", () => {
    const msg = toUserMessage("Zugriff verweigert");
    expect(msg).toContain("Zugriff verweigert");
  });
});
