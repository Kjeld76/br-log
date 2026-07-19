import { useEffect, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  getStatsSummary,
  getCompensationBalance,
  type StatsSummary,
  type CompensationBalance,
} from "../db/repository";
import { minutesToHhmm } from "../lib/time";
import { toUserMessage } from "../lib/errors";
import { errorBoxCls, inputCls } from "../lib/ui";

interface Props {
  reloadKey: number;
}

/** "2026-07" -> "Juli 2026" (dieselbe de-Locale wie im Kalender, Finding 28). */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return format(new Date(y, m - 1, 1), "MMMM yyyy", { locale: de });
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0 %";
  return `${Math.round((part / total) * 100)} %`;
}

export default function StatsView({ reloadKey }: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [balance, setBalance] = useState<CompensationBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Finding 22/53: active-Flag-Guard gegen Out-of-order-Resolution (spät
  // auflösende Antwort eines überholten Zeitraum-Wechsels) + Fehler-UI statt
  // stillem Leerzustand.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getStatsSummary({ from: from || undefined, to: to || undefined }),
      getCompensationBalance(),
    ])
      .then(([s, b]) => {
        if (!active) return;
        setStats(s);
        setBalance(b);
      })
      .catch((e) => {
        if (active) setError(toUserMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, reloadKey]);

  const field = inputCls;
  const card = "rounded-lg border border-border bg-surface p-4";
  const heading = "mb-2 text-sm font-semibold text-primary-ink";

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <header>
        <h2 className="text-lg font-bold text-primary-ink">
          Auswertung
        </h2>
        <p className="text-sm text-secondary-ink">
          Summen und Kennzahlen zur eigenen BR-Zeit.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm text-secondary-ink">
        <span>Zeitraum:</span>
        <input
          type="date"
          className={field}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span>–</span>
        <input
          type="date"
          className={field}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        {(from || to) && (
          <button
            type="button"
            className="text-xs text-secondary-ink hover:underline"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Zeitraum löschen
          </button>
        )}
        <span className="text-xs text-disabled-ink">
          (leer = gesamter Bestand)
        </span>
      </div>

      {loading && (
        <p className="text-sm text-secondary-ink">Lädt…</p>
      )}
      {error && (
        <p className={errorBoxCls}>
          {error}
        </p>
      )}

      {stats && !loading && !error && (
        <>
          {/* Kennzahlen */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={card}>
              <div className="text-xs text-secondary-ink">
                BR-Zeit im Zeitraum
              </div>
              <div className="mt-1 text-xl font-semibold text-primary-ink">
                {minutesToHhmm(stats.totalMinutes)} Std
              </div>
              <div className="text-xs text-disabled-ink">
                ohne Freizeitausgleich
              </div>
            </div>
            <div className={card}>
              <div className="text-xs text-secondary-ink">
                Außerhalb geplanter Schicht
              </div>
              <div className="mt-1 text-xl font-semibold text-primary-ink">
                {minutesToHhmm(stats.outsidePlannedShiftMinutes)} Std
              </div>
              <div className="text-xs text-disabled-ink">
                {pct(stats.outsidePlannedShiftMinutes, stats.totalMinutes)}{" "}
                der BR-Zeit
              </div>
            </div>
            <div className={card}>
              <div className="text-xs text-secondary-ink">
                Widersprüche der GL
              </div>
              <div className="mt-1 text-xl font-semibold text-primary-ink">
                {stats.objectionCount}
              </div>
              <div className="text-xs text-disabled-ink">
                in {stats.objectionEntryCount} Eintrag/Einträgen
              </div>
            </div>
          </div>

          {/* Monats-/Jahres-Summen */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <section className={card}>
              <h3 className={heading}>Je Monat</h3>
              {stats.monthSums.length === 0 ? (
                <p className="text-sm text-secondary-ink">
                  Keine Einträge.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {stats.monthSums.map((m) => (
                    <li key={m.month} className="flex justify-between">
                      <span className="capitalize text-secondary-ink">
                        {monthLabel(m.month)}
                      </span>
                      <span className="font-medium text-primary-ink">
                        {minutesToHhmm(m.minutes)} Std
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={card}>
              <h3 className={heading}>Je Jahr</h3>
              {stats.yearSums.length === 0 ? (
                <p className="text-sm text-secondary-ink">
                  Keine Einträge.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {stats.yearSums.map((y) => (
                    <li key={y.year} className="flex justify-between">
                      <span className="text-secondary-ink">
                        {y.year}
                      </span>
                      <span className="font-medium text-primary-ink">
                        {minutesToHhmm(y.minutes)} Std
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Je Schlagwort */}
          <section className={card}>
            <h3 className={heading}>Je Schlagwort</h3>
            <p className="mb-2 text-xs text-secondary-ink">
              Nur Einträge mit genau einem Schlagwort lassen sich eindeutig
              zuordnen; bei Mehrfachauswahl wäre die Dauer nicht widerspruchsfrei
              aufteilbar.
            </p>
            {stats.tagSums.length === 0 &&
            stats.multiTagMinutes === 0 &&
            stats.untaggedMinutes === 0 ? (
              <p className="text-sm text-secondary-ink">
                Keine Einträge.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {stats.tagSums.map((t) => (
                  <li key={t.tagId} className="flex justify-between">
                    <span className="text-secondary-ink">
                      {t.label}
                    </span>
                    <span className="font-medium text-primary-ink">
                      {minutesToHhmm(t.minutes)} Std
                    </span>
                  </li>
                ))}
                {stats.multiTagMinutes > 0 && (
                  <li className="flex justify-between border-t border-border pt-1 italic text-secondary-ink">
                    <span>
                      Einträge mit mehreren Schlagwörtern (nicht aufteilbar)
                    </span>
                    <span className="font-medium">
                      {minutesToHhmm(stats.multiTagMinutes)} Std
                    </span>
                  </li>
                )}
                {stats.untaggedMinutes > 0 && (
                  <li className="flex justify-between italic text-secondary-ink">
                    <span>Ohne Schlagwort</span>
                    <span className="font-medium">
                      {minutesToHhmm(stats.untaggedMinutes)} Std
                    </span>
                  </li>
                )}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Freizeitausgleich-Saldo (Finding 14) -- läuft bewusst über den
          GESAMTEN Bestand, unabhängig vom oben gewählten Zeitraum (ein Saldo
          ist eine laufende Größe, keine Momentaufnahme eines Ausschnitts). */}
      {balance && !loading && !error && (
        <section className={card}>
          <h3 className={heading}>
            Freizeitausgleich-Saldo (§ 37 Abs. 3 BetrVG)
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-secondary-ink">
                Guthaben (laufend gesamt)
              </div>
              <div className="text-lg font-semibold text-primary-ink">
                {minutesToHhmm(balance.credit)} Std
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary-ink">
                Verbraucht (laufend gesamt)
              </div>
              <div className="text-lg font-semibold text-primary-ink">
                {minutesToHhmm(balance.used)} Std
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary-ink">
                Saldo
              </div>
              <div
                className={
                  "text-lg font-semibold " +
                  (balance.balance < 0
                    ? "text-danger-ink"
                    : "text-primary-ink")
                }
              >
                {minutesToHhmm(balance.balance)} Std
              </div>
            </div>
          </div>

          {balance.byMonth.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-secondary-ink">
                    <th className="py-1">Monat</th>
                    <th className="py-1 text-right">Guthaben</th>
                    <th className="py-1 text-right">Verbraucht</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.byMonth.map((m) => (
                    <tr
                      key={m.month}
                      className="border-t border-border"
                    >
                      <td className="py-1 capitalize text-secondary-ink">
                        {monthLabel(m.month)}
                      </td>
                      <td className="py-1 text-right text-primary-ink">
                        {minutesToHhmm(m.credit)} Std
                      </td>
                      <td className="py-1 text-right text-primary-ink">
                        {minutesToHhmm(m.used)} Std
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-secondary-ink">
            Hinweis: Nach § 37 Abs. 3 BetrVG ist Freizeitausgleich für BR-Arbeit
            außerhalb der Arbeitszeit grundsätzlich innerhalb eines Monats zu
            gewähren; andernfalls entsteht ein Anspruch auf Vergütung wie
            Mehrarbeit. Diese Ansicht ist kein Fristen-Tracker – die
            Monatsfrist je Guthaben-Zuwachs bitte selbst im Blick behalten.
          </p>
        </section>
      )}
    </div>
  );
}
