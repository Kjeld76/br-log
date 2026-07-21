import { describe, expect, it, vi } from "vitest";
import { createLockDelay } from "./lockDelay";

// Karenzzeit vorm Sperren beim Verlassen der App -- NUR Android (Issue #17,
// Task 7). createLockDelay ist reine, zeit-injizierbare Zustandslogik (Muster
// reminderOrchestrator.ts: IO -- hier Start/Abbruch eines Timers UND die
// aktuelle Zeit -- wird über injizierte Callbacks hereingereicht statt direkt
// window.setTimeout/clearTimeout/Date.now aufzurufen). Die Tests injizieren
// deshalb simple Fake-Timer- bzw. Fake-Uhr-Doubles statt vi.useFakeTimers()
// bzw. einer window/document-Umgebung -- das Projekt bleibt bei
// Vitest-environment "node" (s. vitest.config.ts).
function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: vi.fn((cb: () => void, _ms: number) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    }),
    clearTimer: vi.fn((id: number) => {
      pending.delete(id);
    }),
    fire(id: number) {
      const cb = pending.get(id);
      if (!cb) throw new Error(`Kein Timer mit ID ${id} anhängig.`);
      pending.delete(id);
      cb();
    },
    has(id: number) {
      return pending.has(id);
    },
  };
}

// Fake-Uhr für `now` (Android WebView-Timer werden im Hintergrund/bei
// Bildschirm-Aus gedrosselt/pausiert -- setTimer/clearTimer allein reichen
// deshalb NICHT, um zu wissen, ob die Karenz tatsächlich abgelaufen ist,
// s. Tests unten "...auch wenn der Timer nie gefeuert hat").
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("createLockDelay", () => {
  it("sperrt bei Karenz 0 sofort, ohne einen Timer zu starten (Bestandsverhalten)", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 0,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();

    expect(onLock).toHaveBeenCalledTimes(1);
    expect(timers.setTimer).not.toHaveBeenCalled();
  });

  it("startet bei Karenz > 0 einen Timer, statt sofort zu sperren", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();

    expect(onLock).not.toHaveBeenCalled();
    expect(timers.setTimer).toHaveBeenCalledTimes(1);
    expect(timers.setTimer).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("bricht den Timer ab, wenn die App vor Ablauf wieder sichtbar wird -- KEIN Sperren", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    const id = timers.setTimer.mock.results[0].value as number;
    clock.advance(10_000); // deutlich innerhalb der 30s-Karenz
    delay.onVisible();

    expect(timers.clearTimer).toHaveBeenCalledWith(id);
    expect(timers.has(id)).toBe(false);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("sperrt, wenn die Karenz abläuft, ohne dass die App wieder sichtbar wurde", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    const id = timers.setTimer.mock.results[0].value as number;
    timers.fire(id);

    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("startet die Karenz beim zweiten Verstecken neu (alter Timer wird abgebrochen, nicht doppelt gefeuert)", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    const firstId = timers.setTimer.mock.results[0].value as number;
    clock.advance(5_000); // deutlich innerhalb der Karenz -> Rückkehr zählt als rechtzeitig
    delay.onVisible(); // zurückgekehrt, Timer abgebrochen
    delay.onHidden(); // erneut versteckt -> komplett neue Karenz

    expect(timers.has(firstId)).toBe(false);
    expect(timers.setTimer).toHaveBeenCalledTimes(2);
    expect(onLock).not.toHaveBeenCalled();

    const secondId = timers.setTimer.mock.results[1].value as number;
    timers.fire(secondId);

    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("bricht einen anhängigen Timer bei einem zweiten Verstecken ohne Rückkehr ab (kein doppelter Timer)", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    const firstId = timers.setTimer.mock.results[0].value as number;
    delay.onHidden(); // erneut versteckt, OHNE zwischenzeitlich sichtbar geworden zu sein

    expect(timers.clearTimer).toHaveBeenCalledWith(firstId);
    expect(timers.setTimer).toHaveBeenCalledTimes(2);
  });

  // Final-Review-Fund: Android drosselt/pausiert WebView-Timer im
  // Hintergrund bzw. bei Bildschirm-Aus -- der Timer kann deshalb NIE
  // feuern, obwohl die Karenz laut Wanduhr längst abgelaufen ist. Ohne
  // now()-Prüfung würde onVisible() dann fälschlich nur abbrechen, statt zu
  // sperren (App bliebe unbegrenzt entsperrt).
  it("sperrt bei Rückkehr NACH Ablauf der Karenz, auch wenn der Timer nie gefeuert hat (Suspend/Drosselung)", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    const id = timers.setTimer.mock.results[0].value as number;
    clock.advance(40_000); // > 30s Karenz, aber der Timer feuert NICHT (Suspend simuliert)
    delay.onVisible();

    expect(onLock).toHaveBeenCalledTimes(1);
    expect(timers.has(id)).toBe(false); // trotzdem aufgeräumt, kein Doppel-Feuern möglich
  });

  it("sperrt NICHT bei Rückkehr innerhalb der Karenz (Normalfall, Timer wird abgebrochen)", () => {
    const timers = fakeTimers();
    const clock = fakeClock();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: clock.now,
    });

    delay.onHidden();
    clock.advance(10_000); // < 30s Karenz
    delay.onVisible();

    expect(onLock).not.toHaveBeenCalled();
    expect(timers.clearTimer).toHaveBeenCalledTimes(1);
  });
});
