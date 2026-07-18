import { useEffect, useRef, useState } from "react";
import { useBackClose } from "../lib/backClose";
import { Icon } from "./Icon";

type MenuVariant = "sidebar" | "topbar";

interface Props {
  /** "sidebar": Trigger am Fuß der Desktop-Sidebar, Menü öffnet nach OBEN.
   *  "topbar": ⋮-Trigger rechts in der Android-TopBar, Menü öffnet nach UNTEN. */
  variant: MenuVariant;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onLockNow: () => void;
}

// Gemeinsames App-Menü für Desktop (Sidebar-Fuß) UND Android (TopBar) --
// EINE Implementierung für Trigger-Toggle, Popover-Positionierung sowie
// Tastatur-/Fokus-Verhalten statt zweier Parallelbauten. `variant` steuert
// nur das Aussehen des Triggers und die Öffnungsrichtung des Popovers; das
// Verhalten (Escape schließt, Klick außerhalb schließt, Pfeiltasten
// navigieren, Fokus kehrt beim Schließen zum Trigger zurück) ist identisch.
export default function AppMenu({
  variant,
  onOpenSettings,
  onOpenAbout,
  onLockNow,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Klick außerhalb schließt: Document-Listener statt Backdrop-Element --
  // ein Popover ist bewusst kein vollflächiges Modal, ein abdunkelnder
  // Hintergrund wäre hier optisch falsch (siehe Auftrag: "Backdrop ODER
  // Document-Listener").
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Fokus beim Öffnen auf den ersten Menüpunkt.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Android-Zurück-Taste schließt das offene Popover statt die App zu
  // beenden (Mechanik: lib/backClose.ts). Gating über die Variante statt
  // isAndroid(): die topbar-Variante existiert nur in der Android-TopBar
  // (App.tsx rendert TopBar ausschließlich bei mobile), die sidebar-Variante
  // nur auf dem Desktop -- ein eigener mobile-Prop wäre redundant. Kein
  // Fokus-Rücksprung zum Trigger: die Zurück-Geste ist eine Touch-
  // Interaktion, Tastaturfokus spielt dabei keine Rolle.
  useBackClose(variant === "topbar" && open, () => setOpen(false));

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const activate = (fn: () => void) => {
    closeAndRefocus();
    fn();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndRefocus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
    if (items.length === 0) return;
    const idx = items.findIndex((el) => el === document.activeElement);
    const next =
      e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const itemCls =
    "flex min-h-touch w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-secondary-ink hover:bg-surface-2";

  return (
    <div ref={wrapRef} className="relative">
      {variant === "sidebar" ? (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mx-2 mb-2 flex min-h-touch items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-secondary-ink hover:bg-surface-2"
        >
          <Icon name="settings" size={18} />
          Menü
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Menü"
          title="Menü"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-secondary-ink hover:bg-surface-2"
        >
          <Icon name="more-vertical" size={20} />
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label="App-Menü"
          onKeyDown={onMenuKeyDown}
          className={
            "absolute z-dropdown w-56 rounded-lg border border-border bg-surface p-1 shadow-lg " +
            (variant === "sidebar" ? "bottom-full left-2 mb-1" : "right-0 top-full mt-1")
          }
        >
          <button
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => activate(onOpenSettings)}
          >
            <Icon name="settings" size={18} />
            Einstellungen
          </button>
          <button
            ref={(el) => {
              itemRefs.current[1] = el;
            }}
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => activate(onOpenAbout)}
          >
            <Icon name="info" size={18} />
            Über BR-Log
          </button>
          <button
            ref={(el) => {
              itemRefs.current[2] = el;
            }}
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => activate(onLockNow)}
          >
            <Icon name="lock" size={18} />
            Sofort sperren
          </button>
        </div>
      )}
    </div>
  );
}
