// The write machinery behind every store's `mutate()` (DESIGN §7.3): one
// queue of writes per item, an optimistic view of each, retries, version
// conflicts, §5.3's already-exists rule, and cancellation on sign-out. The
// stores own their `$state`; this module only tells them what to show.
import { ApiError, isRetryable } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import type { Toasts } from './toast.svelte.js';

export type MutationResult =
  | { readonly outcome: 'saved' }
  /** Someone else's version is now in the store, and a toast says so. */
  | { readonly outcome: 'conflict' }
  /** Rolled back, with an error toast; or, with a `CancelledError`, abandoned by sign-out (no toast). */
  | { readonly outcome: 'failed'; readonly error: unknown };

export interface RetryOptions {
  /** One delay per retry; the default is 3 retries (§7.3). */
  readonly delays?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RetryCall extends RetryOptions {
  /** Checked before each attempt and after each reply; once it's false, the call stops with `CancelledError`. */
  readonly shouldContinue?: () => boolean;
}

/** A write or create abandoned because the user signed out (or closed the holiday) meanwhile. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

const defaultDelays = [500, 1000, 2000];
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calls `call`, retrying network errors and 5xx after each delay in turn. */
export async function withRetry<T>(call: () => Promise<T>, options: RetryCall = {}): Promise<T> {
  const { delays = defaultDelays, sleep = realSleep, shouldContinue = () => true } = options;
  for (let attempt = 0; ; attempt++) {
    if (!shouldContinue()) throw new CancelledError();
    let result: T;
    try {
      result = await call();
    } catch (error) {
      if (!shouldContinue()) throw new CancelledError();
      const delay = delays[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await sleep(delay);
      continue;
    }
    if (!shouldContinue()) throw new CancelledError();
    return result;
  }
}

/** Whether the stored item has every field the caller sent (§5.3's already-exists rule). */
export function matches(
  stored: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, unknown>>
): boolean {
  return Object.entries(fields).every(
    ([name, value]) => JSON.stringify(stored[name]) === JSON.stringify(value)
  );
}

export interface Versioned {
  readonly version: number;
}

/** One write, and what it meant when the caller made it. */
export interface Write<M> {
  /** The store's own description of the request; the queue only passes it back. */
  readonly mutation: M;
  /** Applied to the item optimistically, and compared on already-exists. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** The write removes the item (a hard delete). */
  readonly remove: boolean;
  /** Names the item in toasts. */
  readonly label: string;
  /** Whether the store showed the item when the caller made the change: an edit, not a create. */
  readonly existed: boolean;
}

/**
 * The writes on one item, sent one at a time. The store shows `confirmed`
 * with each pending write applied in order, so a response or a rollback only
 * updates `confirmed` (or drops the write) and re-projects. A response can't
 * bring back an item that a later queued delete has removed.
 */
export interface Lane<C, I extends Versioned, M> {
  readonly key: string;
  /** What the store needs to find the item again (its holiday, kind and id, say). */
  readonly context: C;
  /** The queue's generation when the lane opened; a newer one means it was reset. */
  readonly generation: number;
  /** The server's copy as last known; `undefined` when it doesn't exist. */
  confirmed: I | undefined;
  /** Writes not yet settled, oldest (the one being sent) first. */
  readonly writes: Queued<M>[];
  tail: Promise<unknown>;
  /** Why the last write failed, for queued edits dropped because of it. */
  failure?: unknown;
}

interface Queued<M> extends Write<M> {
  /** Set when an earlier write on the item got a version conflict. */
  cancelled?: boolean;
}

/** What a store plugs into the queue. */
export interface QueueHooks<C, I extends Versioned, M> {
  /** `item` (or a new item, when `undefined`) with the write's fields applied. */
  apply(lane: Lane<C, I, M>, item: I | undefined, write: Write<M>): I;
  /** Puts the item into the store's state; `undefined` removes it. Only called for live lanes. */
  show(lane: Lane<C, I, M>, item: I | undefined): void;
  /** One attempt at the request. Resolves with the stored item, or `undefined` once it's removed. */
  send(lane: Lane<C, I, M>, write: Write<M>, version: number): Promise<I | undefined>;
  /** Fetches the stored item, for already-exists; `undefined` if there's none. */
  fetchStored(lane: Lane<C, I, M>): Promise<I | undefined>;
  /** The version to send. `undefined` (or no hook) means the confirmed copy's, or 0 for a create. */
  version?(lane: Lane<C, I, M>, write: Write<M>): number | undefined;
  /** Whether a conflict that says the item is gone removes it. Defaults to yes. */
  canVanish?(lane: Lane<C, I, M>): boolean;
}

export interface MutationQueueOptions<C, I extends Versioned, M> extends RetryOptions {
  readonly hooks: QueueHooks<C, I, M>;
  readonly toasts: Toasts;
  /** The conflict toast's action: refetch, so the user sees everyone's changes. */
  readonly refresh: { readonly label: () => string; readonly run: () => void };
}

const cancelled = (): MutationResult => ({ outcome: 'failed', error: new CancelledError() });

/**
 * Per-item write queues (§7.3). Each write shows at once, but is sent only
 * when the one before it on the same item has settled (retries included),
 * with the version that one left. When a queued write's turn comes:
 * - after an earlier write failed, it's computed against the server's copy
 *   as it still is; an edit or delete of an item whose create failed is
 *   dropped without a request (the edit fails, the delete is saved);
 * - after a version conflict, it's dropped as part of that conflict, since
 *   it was made against a copy that someone else has since changed.
 *
 * `reset()` abandons every write: nothing more is sent or applied, and each
 * resolves `failed` with a `CancelledError` and no toast.
 */
export class MutationQueue<C, I extends Versioned, M> {
  readonly #hooks: QueueHooks<C, I, M>;
  readonly #toasts: Toasts;
  readonly #refresh: MutationQueueOptions<C, I, M>['refresh'];
  readonly #retry: RetryOptions;
  /**
   * Bumped by `reset()`. Writes from an older generation send nothing more
   * (each attempt fetches the current user's token, so a retry could
   * otherwise go out as the next user) and change nothing.
   */
  #generation = 0;
  /** Items with writes pending, by key. */
  readonly #lanes = new Map<string, Lane<C, I, M>>();
  /** Items whose writes started or settled since the latest fetch started. */
  readonly #touched = new Map<string, Lane<C, I, M>>();

  constructor(options: MutationQueueOptions<C, I, M>) {
    this.#hooks = options.hooks;
    this.#toasts = options.toasts;
    this.#refresh = options.refresh;
    this.#retry = { delays: options.delays, sleep: options.sleep };
  }

  /**
   * Queues a write on the item at `key`. `shown` is the item as the store
   * shows it now; it becomes the confirmed copy if no writes are pending.
   */
  enqueue(key: string, context: C, shown: I | undefined, write: Write<M>): Promise<MutationResult> {
    let lane = this.#lanes.get(key);
    if (!lane) {
      lane = {
        key,
        context,
        generation: this.#generation,
        confirmed: shown,
        writes: [],
        tail: Promise.resolve()
      };
      this.#lanes.set(key, lane);
    }
    const queued = lane;
    const entry: Queued<M> = { ...write };
    queued.writes.push(entry);
    this.#show(queued);

    const result = queued.tail.then(() => this.#run(queued, entry));
    queued.tail = result.catch(() => undefined);
    return result;
  }

  /** Abandons every write (sign-out, or another holiday opened). */
  reset() {
    this.#generation++;
    this.#lanes.clear();
    this.#touched.clear();
  }

  /** Call when a fetch starts: `written()` then lists the items written since. */
  fetchStarted() {
    this.#touched.clear();
  }

  /**
   * Items a fetch response may be stale for: those with writes pending, and
   * those whose writes started or settled since the fetch started. They should
   * keep what the store shows.
   */
  written(): Lane<C, I, M>[] {
    return [...this.#touched.values(), ...this.#lanes.values()];
  }

  /** Whether the lane is from the current generation. */
  live(lane: Lane<C, I, M>): boolean {
    return lane.generation === this.#generation;
  }

  /** Retries that stop once the lane is abandoned. */
  retryFor(lane: Lane<C, I, M>): RetryCall {
    return { ...this.#retry, shouldContinue: () => this.live(lane) };
  }

  #project(lane: Lane<C, I, M>): I | undefined {
    return lane.writes.reduce<I | undefined>((item, write) => {
      if (write.cancelled) return item;
      if (write.remove) return undefined;
      // An edit of an item that doesn't exist (its create failed) does nothing.
      if (!item && write.existed) return undefined;
      return this.#hooks.apply(lane, item, write);
    }, lane.confirmed);
  }

  /** Shows the lane's item as the server has it, with the pending writes applied. */
  #show(lane: Lane<C, I, M>) {
    if (!this.live(lane)) return;
    this.#touched.set(lane.key, lane);
    this.#hooks.show(lane, this.#project(lane));
  }

  async #run(lane: Lane<C, I, M>, write: Queued<M>): Promise<MutationResult> {
    try {
      return await this.#attempt(lane, write);
    } finally {
      lane.writes.splice(lane.writes.indexOf(write), 1);
      if (lane.writes.length === 0 && this.#lanes.get(lane.key) === lane) {
        this.#lanes.delete(lane.key);
      }
      this.#show(lane);
    }
  }

  async #attempt(lane: Lane<C, I, M>, write: Queued<M>): Promise<MutationResult> {
    if (!this.live(lane)) return cancelled();
    if (write.cancelled) return { outcome: 'conflict' };
    const { remove, existed, fields, label } = write;
    if (!lane.confirmed && (remove || existed)) {
      // Nothing to delete, or the edit is of an item whose create failed.
      return remove ? { outcome: 'saved' } : { outcome: 'failed', error: lane.failure };
    }
    const version = this.#hooks.version?.(lane, write) ?? lane.confirmed?.version ?? 0;

    try {
      lane.confirmed = await withRetry(
        () => this.#hooks.send(lane, write, version),
        this.retryFor(lane)
      );
      return { outcome: 'saved' };
    } catch (error) {
      if (error instanceof CancelledError) return cancelled();
      if (error instanceof ApiError && error.code === 'version-conflict') {
        return this.#conflict(lane, error.current as I | null | undefined, label);
      }
      if (
        error instanceof ApiError &&
        error.code === 'already-exists' &&
        version === 0 &&
        !remove
      ) {
        return this.#alreadyExists(lane, fields, label);
      }
      return this.#fail(lane, error, label);
    }
  }

  /** §5.3: a create that "already exists" may be our own earlier attempt. Compare with the stored item. */
  async #alreadyExists(
    lane: Lane<C, I, M>,
    fields: Readonly<Record<string, unknown>>,
    label: string
  ): Promise<MutationResult> {
    let stored: I | undefined;
    try {
      stored = await withRetry(() => this.#hooks.fetchStored(lane), this.retryFor(lane));
    } catch (error) {
      if (error instanceof CancelledError) return cancelled();
      return this.#fail(lane, error, label);
    }
    if (stored && matches(stored as unknown as Record<string, unknown>, fields)) {
      lane.confirmed = stored;
      return { outcome: 'saved' };
    }
    return this.#conflict(lane, stored ?? null, label);
  }

  /** Keeps the server's copy, and drops the writes queued behind this one. */
  #conflict(lane: Lane<C, I, M>, current: I | null | undefined, label: string): MutationResult {
    if (current) {
      lane.confirmed = current;
    } else if (this.#hooks.canVanish?.(lane) ?? true) {
      lane.confirmed = undefined;
    }
    for (const later of lane.writes.slice(1)) later.cancelled = true;
    const message = current ? 'mutate.conflict' : 'mutate.conflictDeleted';
    this.#toasts.error(t(message, { item: label }), {
      label: this.#refresh.label(),
      run: this.#refresh.run
    });
    return { outcome: 'conflict' };
  }

  /** Rolls back: `confirmed` stays as it was, so re-projecting drops this write. */
  #fail(lane: Lane<C, I, M>, error: unknown, label: string): MutationResult {
    lane.failure = error;
    // A 4xx has a message worth showing; retries running out (or anything else) doesn't.
    const rejected = error instanceof ApiError && !isRetryable(error);
    this.#toasts.error(
      rejected
        ? t('mutate.rejected', { item: label, message: error.message })
        : t('mutate.failed', { item: label })
    );
    return { outcome: 'failed', error };
  }
}
