import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { TimeEntry, TaskTag, EntryListItem } from "./types";
import { initSearch } from "./db/client";
import { listTags, newEntry, deleteEntry, getEntry } from "./db/repository";
import EntryList from "./components/EntryList";
import EntryForm from "./components/EntryForm";
import EntryDetail from "./components/EntryDetail";
import CalendarView from "./components/CalendarView";
import TagManager from "./components/TagManager";
import ExportPanel from "./components/ExportPanel";
import DbInfoPanel from "./components/DbInfoPanel";

type Tab = "uebersicht" | "kalender" | "schlagwoerter" | "export" | "ueber";

type Modal =
  | { type: "form"; entry: TimeEntry }
  | { type: "detail"; entry: EntryListItem }
  | null;

const TABS: { key: Tab; label: string }[] = [
  { key: "uebersicht", label: "Übersicht" },
  { key: "kalender", label: "Kalender" },
  { key: "schlagwoerter", label: "Schlagwörter" },
  { key: "export", label: "Export" },
  { key: "ueber", label: "Über / Daten" },
];

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const bump = () => setReloadKey((k) => k + 1);
  const loadTags = () => listTags().then(setTags);

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

  const handleSaved = () => {
    setModal(null);
    bump();
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setModal(null);
    bump();
  };

  const editFromDetail = async (entry: EntryListItem) => {
    // Frisch aus der DB laden, falls zwischenzeitlich geändert.
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
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold text-slate-800">BR-Zeiten</h1>
          <p className="text-xs text-slate-500">
            Zeiterfassung für Betriebsratsmitglieder
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "whitespace-nowrap rounded px-3 py-1.5 text-sm " +
                (tab === t.key
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-100")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 p-4">
        {tab === "uebersicht" && (
          <EntryList
            tags={tags}
            reloadKey={reloadKey}
            onOpen={openDetail}
            onNewEntry={() => openNew()}
          />
        )}
        {tab === "kalender" && (
          <CalendarView
            reloadKey={reloadKey}
            onOpenEntry={openDetail}
            onNewEntry={(iso) => openNew(iso)}
          />
        )}
        {tab === "schlagwoerter" && (
          <TagManager
            onChanged={() => {
              loadTags();
              bump();
            }}
          />
        )}
        {tab === "export" && <ExportPanel onImported={bump} />}
        {tab === "ueber" && <DbInfoPanel />}
      </main>

      {/* Modal */}
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
                  onSaved={handleSaved}
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
    </div>
  );
}
