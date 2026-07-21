import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, formatAccelerator } from "./hotkey";

// Minimales Double statt eines echten `KeyboardEvent` -- die Vitest-Umgebung
// läuft bewusst mit `environment: "node"` (siehe vitest.config.ts), dort
// existiert kein globaler `KeyboardEvent`-Konstruktor. acceleratorFromEvent
// liest ohnehin nur die hier gesetzten Felder.
function fakeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("acceleratorFromEvent", () => {
  it("baut aus Ctrl+Shift+L den Accelerator 'Ctrl+Shift+L'", () => {
    const e = fakeEvent({ code: "KeyL", key: "l", ctrlKey: true, shiftKey: true });
    expect(acceleratorFromEvent(e)).toBe("Ctrl+Shift+L");
  });

  it("liefert null ganz ohne Modifier (nur die Taste selbst)", () => {
    const e = fakeEvent({ code: "KeyL", key: "l" });
    expect(acceleratorFromEvent(e)).toBeNull();
  });

  it("liefert null bei Shift allein (Modifier-Pflicht ist Ctrl/Alt/Meta, Shift zählt nicht)", () => {
    const e = fakeEvent({ code: "KeyL", key: "L", shiftKey: true });
    expect(acceleratorFromEvent(e)).toBeNull();
  });

  it("liefert null, wenn nur ein Modifier gedrückt wird (keine Zweit-Taste)", () => {
    const e = fakeEvent({ code: "ControlLeft", key: "Control", ctrlKey: true });
    expect(acceleratorFromEvent(e)).toBeNull();
  });

  it("unterstützt Alt + Ziffern", () => {
    const e = fakeEvent({ code: "Digit5", key: "5", altKey: true });
    expect(acceleratorFromEvent(e)).toBe("Alt+5");
  });

  it("wandelt die Meta-/Befehlstaste (metaKey) in den Accelerator-Modifier 'Super'", () => {
    const e = fakeEvent({ code: "KeyL", key: "l", metaKey: true });
    expect(acceleratorFromEvent(e)).toBe("Super+L");
  });

  it("ordnet mehrere Modifier konsistent: Ctrl, Alt, Shift, Super", () => {
    const e = fakeEvent({
      code: "F1",
      key: "F1",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: true,
    });
    expect(acceleratorFromEvent(e)).toBe("Ctrl+Alt+Shift+Super+F1");
  });
});

describe("formatAccelerator", () => {
  it("übersetzt Ctrl und Shift ins Deutsche, '+' und die Taste bleiben", () => {
    expect(formatAccelerator("Ctrl+Shift+L")).toBe("Strg+Umschalt+L");
  });

  it("lässt Alt/Super sowie Tasten ohne deutsche Entsprechung unverändert", () => {
    expect(formatAccelerator("Alt+Super+F5")).toBe("Alt+Super+F5");
  });

  it("funktioniert auch mit nur einem Modifier", () => {
    expect(formatAccelerator("Ctrl+F1")).toBe("Strg+F1");
  });
});
