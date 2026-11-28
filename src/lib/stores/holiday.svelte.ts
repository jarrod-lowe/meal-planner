// The open holiday's facts (DESIGN §7.3): loading, refetch on focus and on
// Refresh, and `mutate()`, which every holiday write goes through.
import { api, ApiError, isRetryable, type ApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { session } from './session.svelte.js';
import { toasts as appToasts, type Toasts } from './toast.svelte.js';

export type HolidayFacts = Schemas['HolidayFacts'];

/** The kinds of item `mutate()` writes, and their stored types. Later phases add meals, trips and stock changes. */
export interface ItemTypes {
  holiday: Schemas['Holiday'];
  attendees: Schemas['Attendee'];
  members: Schemas['Member'];
}

export type ItemKind = keyof ItemTypes;

/** Kinds that live in a list on the facts (everything but the holiday's META). */
type ListKind = Exclude<ItemKind, 'holiday'>;

/** An item's own fields: what the caller sets. The key and the version metadata are the store's job. */
export type Fields<K extends ItemKind> = Omit<
  ItemTypes[K],
  'id' | 'userSub' | 'version' | 'updatedAt' | 'updatedBy'
>;

interface Common {
  /** Names the item in toasts. Defaults to its `name`, or a generic name for the kind. */
  readonly label?: string;
}

/** Create or update an item: it's a create when the store doesn't have it yet. */
export type Save = {
  readonly [K in ListKind]: Common & { kind: K; id: string; fields: Fields<K> };
}[ListKind];
export type Remove = {
  readonly [K in ListKind]: Common & { kind: K; id: string; remove: true };
}[ListKind];
/** Update the open holiday's META. */
export type SaveHoliday = Common & { kind: 'holiday'; fields: Fields<'holiday'> };

export type Mutation = Save | Remove | SaveHoliday;

export type MutationResult =
  | { readonly outcome: 'saved' }
  /** Someone else's version is now in the store, and a toast says so. */
  | { readonly outcome: 'conflict' }
  /** Rolled back, with an error toast. */
  | { readonly outcome: 'failed'; readonly error: unknown };

export type HolidayStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RetryOptions {
  /** One delay per retry; the default is 3 retries (§7.3). */
  readonly delays?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultDelays = [500, 1000, 2000];
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calls `call`, retrying network errors and 5xx after each delay in turn. */
export async function withRetry<T>(call: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { delays = defaultDelays, sleep = realSleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await sleep(delay);
    }
  }
}

export interface HolidayStoreOptions extends RetryOptions {
  readonly api: ApiClient;
  readonly toasts: Toasts;
  /** Milliseconds, for the focus throttle. */
  readonly now?: () => number;
}

/** Refetch on focus no more often than this (§7.3). */
export const focusRefetchMs = 30_000;

type AnyItem = { version: number } & Record<string, unknown>;

/** Which field identifies an item in each list. */
const keyField: Readonly<Record<ListKind, 'id' | 'userSub'>> = {
  attendees: 'id',
  members: 'userSub'
};

function readItem(facts: HolidayFacts, kind: ItemKind, id: string): AnyItem | undefined {
  if (kind === 'holiday') return facts.holiday;
  const list = facts[kind] as readonly AnyItem[];
  return list.find((item) => item[keyField[kind]] === id);
}

function writeItem(facts: HolidayFacts, kind: ItemKind, item: AnyItem): HolidayFacts {
  if (kind === 'holiday') return { ...facts, holiday: item as ItemTypes['holiday'] };
  const key = keyField[kind];
  const list = facts[kind] as readonly AnyItem[];
  const at = list.findIndex((existing) => existing[key] === item[key]);
  const next = at === -1 ? [...list, item] : list.with(at, item);
  return { ...facts, [kind]: next };
}

function dropItem(facts: HolidayFacts, kind: ListKind, id: string): HolidayFacts {
  const list = facts[kind] as readonly AnyItem[];
  return { ...facts, [kind]: list.filter((item) => item[keyField[kind]] !== id) };
}

/** Writes `item` into the facts, or removes the item when it's `undefined`. The META is never removed. */
function putItem(
  facts: HolidayFacts,
  kind: ItemKind,
  id: string,
  item: AnyItem | undefined
): HolidayFacts {
  if (item) return writeItem(facts, kind, item);
  return kind === 'holiday' ? facts : dropItem(facts, kind, id);
}

/** Whether the stored item has every field the caller sent (§5.3's already-exists rule). */
function matches(stored: AnyItem, fields: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(fields).every(
    ([name, value]) => JSON.stringify(stored[name]) === JSON.stringify(value)
  );
}

/** One write, and what it meant when the caller made it. */
interface Op {
  readonly mutation: Mutation;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly label: string;
  /** Whether the store showed the item when the caller made the change: an edit, not a create. */
  readonly existed: boolean;
  /** Set when an earlier write on the item got a version conflict. */
  cancelled?: boolean;
}

/**
 * The writes on one item, sent one at a time. The store shows `confirmed`
 * with each pending write applied in order, so a response or a rollback only
 * updates `confirmed` (or drops the op) and re-projects. A response can't
 * bring back an item that a later queued delete has removed.
 */
interface Lane {
  readonly key: string;
  readonly holidayId: string;
  readonly kind: ItemKind;
  readonly id: string;
  /** The server's copy as last known; `undefined` when it doesn't exist. */
  confirmed: AnyItem | undefined;
  /** Writes not yet settled, oldest (the one being sent) first. */
  readonly ops: Op[];
  tail: Promise<unknown>;
  /** Why the last write failed, for queued edits dropped because of it. */
  failure?: unknown;
}

/** What an op does to the item. An edit of an item that doesn't exist (its create failed) does nothing. */
function applyOp(lane: Lane, item: AnyItem | undefined, op: Op): AnyItem | undefined {
  if (op.cancelled) return item;
  if ('remove' in op.mutation) return undefined;
  if (!item && op.existed) return undefined;
  return {
    updatedAt: '',
    updatedBy: '',
    ...item,
    ...op.fields,
    ...(lane.kind === 'holiday' ? {} : { [keyField[lane.kind]]: lane.id }),
    version: item?.version ?? 0
  };
}

function project(lane: Lane): AnyItem | undefined {
  return lane.ops.reduce<AnyItem | undefined>(
    (item, op) => applyOp(lane, item, op),
    lane.confirmed
  );
}

export class HolidayStore {
  facts = $state.raw<HolidayFacts | null>(null);
  holidayId = $state<string | null>(null);
  status = $state<HolidayStatus>('idle');
  /** Why the last load failed (`ApiError` for 403/404 pages, or `NetworkError`). */
  error = $state.raw<unknown>(null);

  readonly #api: ApiClient;
  readonly #toasts: Toasts;
  readonly #now: () => number;
  readonly #retry: RetryOptions;
  #fetching: Promise<void> | undefined;
  #fetchSeq = 0;
  #lastFetch = Number.NEGATIVE_INFINITY;
  // Write bookkeeping only; `facts` is what views read, so these needn't be reactive.
  /** Items with writes pending, by holiday, kind and id. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not read by any view
  readonly #lanes = new Map<string, Lane>();
  /** Items whose writes started or settled since the latest fetch started. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not read by any view
  readonly #touched = new Map<string, Lane>();

  constructor(options: HolidayStoreOptions) {
    this.#api = options.api;
    this.#toasts = options.toasts;
    this.#now = options.now ?? Date.now;
    this.#retry = { delays: options.delays, sleep: options.sleep };
  }

  /** Opens a holiday and fetches its facts. */
  load(holidayId: string): Promise<void> {
    if (holidayId !== this.holidayId) {
      this.holidayId = holidayId;
      this.facts = null;
      this.error = null;
      this.#fetching = undefined;
    }
    return this.refresh();
  }

  /** Refetches the open holiday; concurrent calls share one request. */
  refresh(): Promise<void> {
    const holidayId = this.holidayId;
    if (!holidayId) return Promise.resolve();
    this.#fetching ??= this.#fetch(holidayId).finally(() => (this.#fetching = undefined));
    return this.#fetching;
  }

  /** Refetches if the last fetch was at least 30 s ago. */
  refetchIfStale() {
    if (this.holidayId && this.#now() - this.#lastFetch >= focusRefetchMs) void this.refresh();
  }

  /** Refetches on the target's `focus` events (the window, by default). Returns a detach. */
  attachFocusRefetch(target: EventTarget = window): () => void {
    const onFocus = () => this.refetchIfStale();
    target.addEventListener('focus', onFocus);
    return () => target.removeEventListener('focus', onFocus);
  }

  /** Closes the holiday, e.g. on sign-out. */
  clear() {
    this.#fetchSeq++;
    this.#fetching = undefined;
    this.holidayId = null;
    this.facts = null;
    this.error = null;
    this.status = 'idle';
    this.#lastFetch = Number.NEGATIVE_INFINITY;
  }

  /**
   * Writes one item (§7.3): applies it at once, sends it with the item's
   * version, then keeps the server's copy. A version conflict keeps the
   * server's copy too, with a toast. Network errors and 5xx retry, then roll
   * back with a toast; other errors roll back at once.
   *
   * Writes on the same item are queued: each shows at once, but is sent only
   * when the one before it has settled (retries included), with the version
   * that one left. When a queued write's turn comes:
   * - after an earlier write failed, it's computed against the server's copy
   *   as it still is; an edit or delete of an item whose create failed is
   *   dropped without a request (the edit fails, the delete is saved);
   * - after a version conflict, it's dropped as part of that conflict, since
   *   it was made against a copy that someone else has since changed.
   */
  async mutate(mutation: Mutation): Promise<MutationResult> {
    const facts = this.facts;
    if (!facts) throw new Error('mutate() needs a loaded holiday');
    const holidayId = facts.holiday.id;
    const { kind } = mutation;
    const id = mutation.kind === 'holiday' ? holidayId : mutation.id;
    const key = `${holidayId} ${kind} ${id}`;
    const shown = readItem(facts, kind, id);
    const fields: Readonly<Record<string, unknown>> = 'fields' in mutation ? mutation.fields : {};
    const op: Op = {
      mutation,
      fields,
      label: this.#label(mutation, fields, shown),
      existed: shown !== undefined
    };

    let lane = this.#lanes.get(key);
    if (!lane) {
      lane = { key, holidayId, kind, id, confirmed: shown, ops: [], tail: Promise.resolve() };
      this.#lanes.set(key, lane);
    }
    const queued = lane;
    queued.ops.push(op);
    this.#show(queued);

    const result = queued.tail.then(() => this.#run(queued, op));
    queued.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * A write that started or settled while a fetch was out may be missing from
   * its response. So the response replaces every item except those: they
   * keep what the store shows, which is the server's copy from the write's
   * own response with any pending writes applied.
   */
  async #fetch(holidayId: string) {
    const seq = ++this.#fetchSeq;
    this.#touched.clear();
    this.#lastFetch = this.#now();
    if (!this.facts) this.status = 'loading';
    try {
      const facts = await this.#api.get('/holidays/{holidayId}', { holidayId });
      if (seq !== this.#fetchSeq || holidayId !== this.holidayId) return;
      this.facts = this.#keepWritten(facts);
      this.error = null;
      this.status = 'ready';
    } catch (error) {
      if (seq !== this.#fetchSeq || holidayId !== this.holidayId) return;
      if (this.facts) {
        this.#toasts.error(t('holiday.refreshFailed'));
      } else {
        this.error = error;
        this.status = 'error';
      }
    }
  }

  #keepWritten(fetched: HolidayFacts): HolidayFacts {
    const local = this.facts;
    if (local?.holiday.id !== fetched.holiday.id) return fetched;
    let next = fetched;
    for (const lane of [...this.#touched.values(), ...this.#lanes.values()]) {
      if (lane.holidayId !== local.holiday.id) continue;
      next = putItem(next, lane.kind, lane.id, readItem(local, lane.kind, lane.id));
    }
    return next;
  }

  /** Shows the lane's item as the server has it, with the pending writes applied. */
  #show(lane: Lane) {
    this.#touched.set(lane.key, lane);
    if (this.facts?.holiday.id !== lane.holidayId) return;
    this.facts = putItem(this.facts, lane.kind, lane.id, project(lane));
  }

  async #run(lane: Lane, op: Op): Promise<MutationResult> {
    try {
      return await this.#attempt(lane, op);
    } finally {
      lane.ops.splice(lane.ops.indexOf(op), 1);
      if (lane.ops.length === 0 && this.#lanes.get(lane.key) === lane) {
        this.#lanes.delete(lane.key);
      }
      this.#show(lane);
    }
  }

  async #attempt(lane: Lane, op: Op): Promise<MutationResult> {
    if (op.cancelled) return { outcome: 'conflict' };
    const { mutation, fields, label } = op;
    const { kind, id, holidayId } = lane;
    const remove = 'remove' in mutation;
    if (!lane.confirmed && (remove || op.existed)) {
      // Nothing to delete, or the edit is of an item whose create failed.
      return remove ? { outcome: 'saved' } : { outcome: 'failed', error: lane.failure };
    }
    // Members are only ever created (§5.1); everything else sends the version the server last gave.
    const version = kind === 'members' ? 0 : (lane.confirmed?.version ?? 0);

    try {
      lane.confirmed = await withRetry(
        () => this.#send(mutation, holidayId, id, version),
        this.#retry
      );
      return { outcome: 'saved' };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'version-conflict') {
        return this.#conflict(lane, error.current as AnyItem | null | undefined, label);
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

  /** One attempt at the request. Resolves with the stored item, or `undefined` for a delete. */
  async #send(
    mutation: Mutation,
    holidayId: string,
    id: string,
    version: number
  ): Promise<AnyItem | undefined> {
    const api = this.#api;
    if ('remove' in mutation) {
      if (mutation.kind === 'attendees') {
        await api.del('/holidays/{holidayId}/attendees/{id}', { holidayId, id });
      } else {
        await api.del('/holidays/{holidayId}/members/{userSub}', { holidayId, userSub: id });
      }
      return undefined;
    }
    switch (mutation.kind) {
      case 'holiday':
        return api.put('/holidays/{holidayId}', { holidayId }, { ...mutation.fields, version });
      case 'attendees':
        return api.put(
          '/holidays/{holidayId}/attendees/{id}',
          { holidayId, id },
          { ...mutation.fields, version }
        );
      case 'members':
        return api.put(
          '/holidays/{holidayId}/members/{userSub}',
          { holidayId, userSub: id },
          { version: 0 }
        );
    }
  }

  /** §5.3: a create that "already exists" may be our own earlier attempt. Compare with the stored item. */
  async #alreadyExists(
    lane: Lane,
    fields: Readonly<Record<string, unknown>>,
    label: string
  ): Promise<MutationResult> {
    const { holidayId, kind, id } = lane;
    let stored: AnyItem | undefined;
    try {
      const fresh = await withRetry(
        () => this.#api.get('/holidays/{holidayId}', { holidayId }),
        this.#retry
      );
      stored = readItem(fresh, kind, id);
    } catch (error) {
      return this.#fail(lane, error, label);
    }
    if (stored && matches(stored, fields)) {
      lane.confirmed = stored;
      return { outcome: 'saved' };
    }
    return this.#conflict(lane, stored ?? null, label);
  }

  /** Keeps the server's copy, and drops the writes queued behind this one. */
  #conflict(lane: Lane, current: AnyItem | null | undefined, label: string): MutationResult {
    if (current) {
      lane.confirmed = current;
    } else if (lane.kind !== 'holiday') {
      lane.confirmed = undefined;
    }
    for (const later of lane.ops.slice(1)) later.cancelled = true;
    const message = current ? 'mutate.conflict' : 'mutate.conflictDeleted';
    this.#toasts.error(t(message, { item: label }), {
      label: t('mutate.refreshHoliday'),
      run: () => void this.refresh()
    });
    return { outcome: 'conflict' };
  }

  /** Rolls back: `confirmed` stays as it was, so re-projecting drops this write. */
  #fail(lane: Lane, error: unknown, label: string): MutationResult {
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

  #label(
    mutation: Mutation,
    fields: Readonly<Record<string, unknown>>,
    shown: AnyItem | undefined
  ): string {
    if (mutation.label) return mutation.label;
    const name = fields.name ?? shown?.name;
    return typeof name === 'string' && name ? name : t(`mutate.items.${mutation.kind}`);
  }
}

export const holiday = new HolidayStore({ api, toasts: appToasts });
session.onSignOut(() => holiday.clear());
