import { useState } from "react";
import { parseISO } from "date-fns";
import type { EntryListItem } from "../types";
import AppointmentMonthGrid from "../components/AppointmentMonthGrid";
import AppointmentAgenda from "../components/AppointmentAgenda";
import SegmentedControl from "../components/SegmentedControl";
import { shiftMonth, todayIso } from "../lib/calendar";
import { inputCls, secondaryBtnSmCls } from "../lib/ui";
import type { Occurrence } from "../lib/appointments";

type SubTab = "monat" | "agenda";

const SUB_TAB_OPTIONS: { value: SubTab; label: string }[] = [
  { value: "monat", label: "Monat" },
  { value: "agenda", label: "Agenda" },
];

// Persistenz der Unteransicht wie beim früheren Historie-Sub-Tab (Finding 29):
// App.tsx unmountet die View bei jedem Tab-Wechsel, ohne localStorage ginge
// die bevorzugte Ansicht jedes Mal verloren.
const SUB_TAB_KEY = "brlog.calendarSubTab";

function loadSubTab(): SubTab {
  try {
    return localStorage.getItem(SUB_TAB_KEY) === "agenda" ? "agenda" : "monat";
  } catch {
    return "monat";
  }
}

function saveSubTab(v: SubTab): void {
  try {
    localStorage.setItem(SUB_TAB_KEY, v);
  } catch {
    // Persistenz ist nur Komfort, kein Pflichtpfad.
  }
}

interface Props {
  reloadKey: number;
  onOpenEntry: (entry: EntryListItem) => void;
  onNewEntry: (iso: string) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  onNewAppointment: (iso: string) => void;
}

export default function CalendarPage({
  reloadKey,
  onOpenEntry,
  onNewEntry,
  onOpenOccurrence,
  onNewAppointment,
}: Props) {
  const [sub, setSub] = useState<SubTab>(() => loadSubTab());
  const [month, setMonth] = useState<Date>(() => new Date());

  const selectSub = (s: SubTab) => {
    setSub(s);
    saveSubTab(s);
  };

  const jumpTo = (iso: string) => {
    if (!iso) return;
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return;
    setMonth(d);
    if (sub !== "monat") selectSub("monat");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Kalender
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {sub === "monat" && (
            <>
              <button
                type="button"
                className={secondaryBtnSmCls}
                onClick={() => setMonth(new Date())}
                title="Zum aktuellen Monat springen"
              >
                Heute
              </button>
              {/* Springe-zu-Datum: natives Datumsfeld, Wert wird nicht
                  gehalten -- jede Auswahl springt einmalig zum Monat. */}
              <input
                type="date"
                className={inputCls + " py-1.5"}
                aria-label="Zu Datum springen"
                title="Zu Datum springen"
                value=""
                onChange={(e) => jumpTo(e.target.value)}
              />
            </>
          )}
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            onClick={() => onNewAppointment(todayIso())}
          >
            + Termin
          </button>
          <SegmentedControl options={SUB_TAB_OPTIONS} value={sub} onChange={selectSub} />
        </div>
      </header>

      {sub === "monat" ? (
        <AppointmentMonthGrid
          month={month}
          onShiftMonth={(delta) => setMonth((m) => shiftMonth(m, delta))}
          reloadKey={reloadKey}
          onOpenEntry={onOpenEntry}
          onNewEntry={onNewEntry}
          onOpenOccurrence={onOpenOccurrence}
          onNewAppointment={onNewAppointment}
        />
      ) : (
        <AppointmentAgenda reloadKey={reloadKey} onOpenOccurrence={onOpenOccurrence} />
      )}
    </div>
  );
}
