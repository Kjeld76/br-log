import { useEffect, useRef } from "react";
import { secondaryBtnCls } from "../lib/ui";

export type SeriesScope = "single" | "following" | "all";

interface Props {
  /** "bearbeiten" oder "löschen" -- nur für die Beschriftung. */
  mode: "edit" | "delete";
  onSelect: (scope: SeriesScope) => void;
  onCancel: () => void;
}

/**
 * Drei-Optionen-Dialog für Serientermine ("Nur dieser / Dieser und folgende /
 * Alle") -- Optik des Bestätigungsdialogs in App.tsx, aber mit gestapelten
 * Aktions-Buttons, da drei gleichrangige Wege zur Wahl stehen. Eigene, kleine
 * Fokus-Logik (Autofokus + Escape) statt useModalFocusTrap: der Dialog liegt
 * wie der Bestätigungsdialog ÜBER einem evtl. offenen Modal.
 */
export default function SeriesScopeDialog({ mode, onSelect, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const verb = mode === "edit" ? "bearbeiten" : "löschen";
  const actionCls =
    "w-full rounded border border-slate-300 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Serientermin ${verb}`}
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl outline-none dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Dies ist ein Serientermin. Was möchtest du {verb}?
        </p>
        <div className="mt-3 space-y-2">
          <button type="button" className={actionCls} onClick={() => onSelect("single")}>
            Nur diesen Termin
          </button>
          <button
            type="button"
            className={actionCls}
            onClick={() => onSelect("following")}
          >
            Diesen und alle folgenden
          </button>
          <button type="button" className={actionCls} onClick={() => onSelect("all")}>
            Alle Termine der Serie
          </button>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className={secondaryBtnCls} onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
