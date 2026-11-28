// The holiday-local "now" (DESIGN §1, §7.3): a `LocalDateTime` in the open
// holiday's time zone, ticking on each minute. The engine only ever gets it
// as a string.
import type { LocalDateTime } from '#lib/engine/index.js';
import { holiday } from './holiday.svelte.js';
import { localNow } from './local-now.js';

/** The time source, so tests can move it by hand. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

const minuteMs = 60_000;

export interface NowStoreOptions {
  /** The time zone to show, or `undefined` while no holiday is open. */
  readonly timeZone: () => string | null | undefined;
  readonly clock?: Clock;
}

export class NowStore {
  #ms = $state(0);
  readonly #timeZone: () => string | null | undefined;
  readonly #clock: Clock;
  #starts = 0;
  #timer: unknown;

  /** Holiday-local now, or `null` without a time zone. Moves on each minute while started. */
  readonly current = $derived.by<LocalDateTime | null>(() => {
    const timeZone = this.#timeZone();
    return timeZone ? localNow(this.#ms, timeZone) : null;
  });

  constructor(options: NowStoreOptions) {
    this.#timeZone = options.timeZone;
    this.#clock = options.clock ?? realClock;
    this.#ms = this.#clock.now();
  }

  /** Ticks on each minute until every caller has stopped. Returns a stop. */
  start(): () => void {
    if (this.#starts++ === 0) this.#tick();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.#starts === 0) this.#clock.clearTimeout(this.#timer);
    };
  }

  #tick() {
    this.#ms = this.#clock.now();
    this.#timer = this.#clock.setTimeout(() => this.#tick(), minuteMs - (this.#ms % minuteMs));
  }
}

/** Now in the open holiday's time zone. The holiday layout starts it ticking. */
export const now = new NowStore({ timeZone: () => holiday.facts?.holiday.timeZone });
