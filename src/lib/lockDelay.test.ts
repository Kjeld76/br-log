import { describe, expect, it, vi } from "vitest";
import { createLockDelay } from "./lockDelay";

// Karenzzeit vorm Sperren beim Verlassen der App -- NUR Android (Issue #17,
// Task 7). createLockDelay ist reine, zeit-injizierbare Zustandslogik (Muster
// reminderOrchestrator.ts: IO -- hier Start/Abbruch eines Timers -- wird über
// injizierte Callbacks hereingereicht statt direkt window.setTimeout/
// clearTimeout aufzurufen). Die Tests injizieren deshalb simple Fake-Timer-
// Doubles (ID-Zähler + Callback-Register) statt vi.useFakeTimers() bzw. einer
// window/document-Umgebung -- das Projekt bleibt bei Vitest-environment
// "node" (s. vitest.config.ts).
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

describe("createLockDelay", () => {
  it("sperrt bei Karenz 0 sofort, ohne einen Timer zu starten (Bestandsverhalten)", () => {
    const timers = fakeTimers();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 0,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();

    expect(onLock).toHaveBeenCalledTimes(1);
    expect(timers.setTimer).not.toHaveBeenCalled();
  });

  it("startet bei Karenz > 0 einen Timer, statt sofort zu sperren", () => {
    const timers = fakeTimers();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();

    expect(onLock).not.toHaveBeenCalled();
    expect(timers.setTimer).toHaveBeenCalledTimes(1);
    expect(timers.setTimer).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("bricht den Timer ab, wenn die App vor Ablauf wieder sichtbar wird -- KEIN Sperren", () => {
    const timers = fakeTimers();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();
    const id = timers.setTimer.mock.results[0].value as number;
    delay.onVisible();

    expect(timers.clearTimer).toHaveBeenCalledWith(id);
    expect(timers.has(id)).toBe(false);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("sperrt, wenn die Karenz abläuft, ohne dass die App wieder sichtbar wurde", () => {
    const timers = fakeTimers();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();
    const id = timers.setTimer.mock.results[0].value as number;
    timers.fire(id);

    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("startet die Karenz beim zweiten Verstecken neu (alter Timer wird abgebrochen, nicht doppelt gefeuert)", () => {
    const timers = fakeTimers();
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();
    const firstId = timers.setTimer.mock.results[0].value as number;
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
    const onLock = vi.fn();
    const delay = createLockDelay({
      delaySec: 30,
      onLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    delay.onHidden();
    const firstId = timers.setTimer.mock.results[0].value as number;
    delay.onHidden(); // erneut versteckt, OHNE zwischenzeitlich sichtbar geworden zu sein

    expect(timers.clearTimer).toHaveBeenCalledWith(firstId);
    expect(timers.setTimer).toHaveBeenCalledTimes(2);
  });
});
