// Runs in the components project, where `$state` and `$derived` are reactive.
import { describe, expect, it } from 'vitest';
import { NowStore, type Clock } from './now.svelte.js';

/** A clock the test moves by hand, with timers that fire when it passes them. */
function fakeClock(start: string) {
  let ms = Date.parse(start);
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    now: () => ms,
    setTimeout: (run, delay) => {
      const id = ++next;
      timers.set(id, { at: ms + delay, run });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number)
  };
  const advance = (by: number) => {
    const until = ms + by;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      ms = timer.at;
      timer.run();
    }
    ms = until;
  };
  return { clock, advance, pending: () => [...timers.values()].map((timer) => timer.at - ms) };
}

describe('NowStore', () => {
  it('is null until there is a time zone', () => {
    const { clock } = fakeClock('2026-12-26T05:07:30Z');
    const zone = $state<{ name?: string }>({});
    const now = new NowStore({ timeZone: () => zone.name, clock });

    expect(now.current).toBeNull();
    zone.name = 'Pacific/Auckland';
    expect(now.current).toBe('2026-12-26T18:07');
  });

  it('follows the open holiday’s time zone', () => {
    const { clock } = fakeClock('2026-12-26T05:07:30Z');
    const zone = $state({ name: 'Pacific/Auckland' });
    const now = new NowStore({ timeZone: () => zone.name, clock });

    expect(now.current).toBe('2026-12-26T18:07');
    zone.name = 'Europe/London';
    expect(now.current).toBe('2026-12-26T05:07');
  });

  it('ticks on each minute once started, and stops', () => {
    const { clock, advance, pending } = fakeClock('2026-12-31T10:58:45Z');
    const now = new NowStore({ timeZone: () => 'Pacific/Auckland', clock });
    const stop = now.start();

    // Aligned to the minute: the first tick is 15 s away.
    expect(pending()).toEqual([15_000]);
    advance(14_999);
    expect(now.current).toBe('2026-12-31T23:58');
    advance(1);
    expect(now.current).toBe('2026-12-31T23:59');
    expect(pending()).toEqual([60_000]);
    advance(60_000);
    expect(now.current).toBe('2027-01-01T00:00');

    stop();
    expect(pending()).toEqual([]);
  });

  it('reads the clock again when started, after a while stopped', () => {
    const { clock, advance } = fakeClock('2026-12-26T05:07:30Z');
    const now = new NowStore({ timeZone: () => 'UTC', clock });
    advance(5 * 60_000);

    const stop = now.start();
    expect(now.current).toBe('2026-12-26T05:12');
    stop();
  });

  it('keeps one timer however many times it’s started, until the last stop', () => {
    const { clock, pending } = fakeClock('2026-12-26T05:07:30Z');
    const now = new NowStore({ timeZone: () => 'UTC', clock });

    const stopA = now.start();
    const stopB = now.start();
    expect(pending()).toHaveLength(1);
    stopA();
    expect(pending()).toHaveLength(1);
    stopB();
    expect(pending()).toHaveLength(0);
  });
});
