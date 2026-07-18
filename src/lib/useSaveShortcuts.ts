import { useEffect, useRef } from "react";

/**
 * Formular-Tastaturkürzel: Strg/Cmd+Enter speichert, Escape bricht ab
 * (Dirty-Check übernimmt der Aufrufer über cancel). EINE Implementierung für
 * EntryForm und AppointmentForm -- Verhaltenskorrekturen (z. B. Kürzel bei
 * überlagerndem Dialog ignorieren) landen damit automatisch in beiden.
 */
export function useSaveShortcuts(args: {
  save: () => void;
  cancel?: () => void;
  saving: boolean;
}): void {
  // Über einen Ref angebunden: der Listener bleibt stabil registriert, sieht
  // aber immer den aktuellen Stand (kein Re-Subscribe bei jeder Eingabe).
  const ref = useRef(args);
  ref.current = args;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!ref.current.saving) ref.current.save();
      } else if (e.key === "Escape" && ref.current.cancel) {
        e.preventDefault();
        ref.current.cancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
