// Android-Zurück-Taste: Overlays schließen statt die App zu beenden.
//
// Tauri/Android navigiert bei der System-Zurück-Taste die WebView-History
// zurück, wenn sie kann -- sonst geht die App in den Hintergrund (und der
// visibilitychange-Auto-Lock in App.tsx sperrt, gewollt). Die App selbst hat
// keinen Router: Solange KEIN Overlay offen ist, bleibt die History leer und
// Zurück verlässt die App wie gewohnt. Sobald ein schließbares Overlay
// (Modal, Bestätigungsdialog, AppMenu-Popover) offen ist, liegt GENAU EIN
// Dummy-Eintrag auf der History -- die Zurück-Taste löst dann popstate aus
// und schließt das oberste offene Element, statt die App zu beenden.
//
// Warum EIN gemeinsamer Eintrag statt eines Eintrags pro Overlay: Die
// Rückfrage "Ungespeicherte Änderungen verwerfen?" öffnet sich ÜBER dem
// Formular-Modal. Bricht der Nutzer die Rückfrage ab ("Zurück"-Button),
// bliebe bei Eintrag-pro-Overlay dessen Eintrag verbraucht -- der nächste
// Zurück-Druck würde die App beenden statt erneut zu fragen. Mit dem
// Invariant "irgendwas offen <-> ein Eintrag armiert" bleibt die Taste
// verlässlich, egal auf welchem Weg Overlays geöffnet/geschlossen werden.
//
// Warum microtask-debounced: Beim Übergang Menü -> Einstellungen-Modal
// schließt das eine Overlay und öffnet das andere im selben React-Commit.
// Ein sofortiges history.back() (Menü zu) gefolgt von pushState (Modal auf)
// würde wegen der ASYNCHRONEN History-Traversierung den frischen Eintrag
// konsumieren und das gerade geöffnete Modal sofort wieder schließen. Der
// gesammelte Abgleich pro Tick sieht stattdessen: vorher 1 Handler, nachher
// 1 Handler -> keine History-Operation nötig.
import { useEffect, useRef } from "react";

type BackHandler = () => void;

interface BackState {
  brlogBack?: boolean;
}

// Stapel der offenen Overlays (zuletzt registriert = oberstes Element).
let handlers: BackHandler[] = [];
// true = unser Dummy-Eintrag liegt oben auf dem History-Stack.
let armed = false;
// Nächsten popstate ignorieren (kommt von unserem eigenen history.back()).
let suppressPop = false;
let syncQueued = false;
let listenerInstalled = false;

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    if (handlers.length > 0 && !armed) {
      window.history.pushState({ brlogBack: true } satisfies BackState, "");
      armed = true;
    } else if (handlers.length === 0 && armed) {
      armed = false;
      if ((window.history.state as BackState | null)?.brlogBack) {
        suppressPop = true;
        window.history.back();
      }
    }
  });
}

function onPopState(): void {
  if (suppressPop) {
    suppressPop = false;
    return;
  }
  if (!armed) return; // Pop außerhalb unserer Verwaltung -- nicht anfassen.
  // System-Zurück hat den Dummy-Eintrag konsumiert: oberstes Overlay
  // schließen. Der Handler darf dabei ein neues Overlay öffnen (Dirty-
  // Rückfrage) oder das letzte schließen -- der anschließende Sync armiert
  // neu bzw. lässt die History leer.
  armed = false;
  handlers[handlers.length - 1]?.();
  scheduleSync();
}

/**
 * Registriert ein offenes Overlay für die Zurück-Taste. Gibt die
 * Deregistrier-Funktion zurück (beim Schließen auf beliebigem Weg aufrufen --
 * X-Button, Backdrop, Escape; die History wird automatisch abgeglichen).
 * Nur für Android gedacht -- der Aufrufer gated (siehe useBackClose).
 */
export function registerBackHandler(handler: BackHandler): () => void {
  if (!listenerInstalled) {
    listenerInstalled = true;
    window.addEventListener("popstate", onPopState);
  }
  handlers.push(handler);
  scheduleSync();
  return () => {
    handlers = handlers.filter((h) => h !== handler);
    scheduleSync();
  };
}

/**
 * React-Anbindung: solange `active` true ist, schließt die Android-Zurück-
 * Taste dieses Overlay (statt die App zu beenden). `onBack` wird über eine
 * Ref immer in der aktuellen Fassung aufgerufen -- Closures über modal/
 * formDirty (requestCloseModal) veralten nicht.
 */
export function useBackClose(active: boolean, onBack: BackHandler): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => onBackRef.current());
  }, [active]);
}
