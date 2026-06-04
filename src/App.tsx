import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { TimeEntry, TaskTag, EntryListItem } from "./types";
import { initSearch } from "./db/client";
import { listTags, newEntry, deleteEntry, getEntry } from "./db/repository";
import Sidebar, { type View } from "./components/Sidebar";
import QuickEntryView from "./views/QuickEntryView";
import HistoryView from "./views/HistoryView";
import DataView from "./views/DataView";
import EntryForm from "./components/EntryForm";
import EntryDetail from "./components/EntryDetail";

type Modal =
  | { type: "form"; entry: TimeEntry }
  | { type: "detail"; entry: EntryListItem }
  | null;

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<View>("erfassen");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);

  const bump = () => setReloadKey((k) => k + 1);
  const loadTags = () => listTags().then(setTags);
  const showToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    (async () => {
      try {
        await initSearch();
        await loadTags();
        setReady(true);
      } catch (e) {
        setInitError(String(e));
      }
    })();
  }, []);

  const openNew = (iso?: string) =>
    setModal({ type: "form", entry: newEntry(iso ?? todayIso()) });
  const openDetail = (entry: EntryListItem) =>
    setModal({ type: "detail", entry });

  const handleModalSaved = () => {
    setModal(null);
    bump();
    showToast("Eintrag gespeichert");
  };
  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setModal(null);
    bump();
    showToast("Eintrag gelöscht");
  };
  const editFromDetail = async (entry: EntryListItem) => {
    const fresh = (await getEntry(entry.id)) ?? entry;
    setModal({ type: "form", entry: fresh });
  };

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        {initError ? (
          <div className="max-w-md p-4 text-center">
            <p className="font-medium text-red-600">Fehler beim Start</p>
            <p className="mt-1 break-all text-sm">{initError}</p>
          </div>
        ) : (
          "Datenbank wird initialisiert…"
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar view={view} onNavigate={setView} />

      <main className="flex-1 overflow-y-auto">
        {view === "erfassen" && (
          <QuickEntryView
            tags={tags}
            onSaved={() => {
              bump();
              showToast("Eintrag gespeichert");
            }}
          />
        )}
        {view === "historie" && (
          <HistoryView
            tags={tags}
            reloadKey={reloadKey}
            onOpenEntry={openDetail}
            onNewEntry={openNew}
          />
        )}
        {view === "daten" && (
          <DataView
            onChanged={() => {
              loadTags();
              bump();
            }}
          />
        )}
      </main>

      {/* Modal: Detailansicht / Bearbeiten / Schnell-Anlegen aus Kalender/Liste */}
      {modal && (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="my-4 w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "form" && (
              <>
                <h2 className="mb-3 text-base font-semibold text-slate-800">
                  Eintrag
                </h2>
                <EntryForm
                  entry={modal.entry}
                  tags={tags}
                  onSaved={handleModalSaved}
                  onCancel={() => setModal(null)}
                />
              </>
            )}
            {modal.type === "detail" && (
              <>
                <h2 className="mb-3 text-base font-semibold text-slate-800">
                  Eintrag-Details
                </h2>
                <EntryDetail
                  entry={modal.entry}
                  onEdit={() => editFromDetail(modal.entry)}
                  onDelete={() => handleDelete(modal.entry.id)}
                  onClose={() => setModal(null)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
