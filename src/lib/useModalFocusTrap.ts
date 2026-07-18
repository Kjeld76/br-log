import { useEffect } from "react";

/**
 * Fokussiert beim Öffnen das erste fokussierbare Element im Dialog-Container
 * und hält Tab/Shift+Tab innerhalb des Dialogs (Fokusfalle). Ohne das springt
 * der Tastaturfokus beim Tabben aus dem Modal in den verdeckten Hintergrund --
 * für Tastatur-/Screenreader-Nutzer ist der Dialog dann kaum bedienbar
 * (Finding 41: Modal ohne role="dialog"/aria-modal und ohne Fokusfalle).
 * Gilt für ALLE Dialog-Ebenen (Modals, Bestätigungs- und Scope-Dialoge).
 */
export function useModalFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  // Finding B5: ohne explizite Zielangabe fokussiert die Falle blind das
  // ERSTE fokussierbare Element im Container -- im Bearbeiten-Modal kann das
  // z. B. der "Übernehmen"-Hinweis-Button (showLastDefaultsHint) VOR dem
  // Datumsfeld sein und damit den seit W1 vorgesehenen Autofokus auf das
  // Datumsfeld unterlaufen. initialFocusRef erlaubt es dem Aufrufer, das
  // tatsächlich gewünschte Ziel vorzugeben; ohne Angabe bleibt das bisherige
  // Verhalten (erstes fokussierbares Element) unverändert.
  initialFocusRef?: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));

    const first = initialFocusRef?.current ?? focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [ref, active, initialFocusRef]);
}
