import { useEffect, useRef } from "react";
import { secondaryBtnCls } from "../lib/ui";
import { useModalFocusTrap } from "../lib/useModalFocusTrap";

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
 * Aktions-Buttons, da drei gleichrangige Wege zur Wahl stehen. Nutzt die
 * geteilte Fokusfalle: auch als oberste Dialog-Ebene über einem Modal darf
 * Tab nicht in das darunterliegende Detail-Modal springen.
 */
export default function SeriesScopeDialog({ mode, onSelect, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocusTrap(ref, true);

  useEffect(() => {
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
    "w-full rounded border border-border-strong px-4 py-2 text-left text-sm text-primary-ink hover:bg-surface-2";

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-overlay p-4"
      onClick={onCancel}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Serientermin ${verb}`}
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-surface p-4 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-primary-ink">
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
