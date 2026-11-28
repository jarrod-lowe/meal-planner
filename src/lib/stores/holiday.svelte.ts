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

/** Whether the stored item has every field the caller sent (§5.3's already-exists rule). */
function matches(stored: AnyItem, fields: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(fields).every(
    ([name, value]) => JSON.stringify(stored[name]) === JSON.stringify(value)
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
   */
  async mutate(mutation: Mutation): Promise<MutationResult> {
    const facts = this.facts;
    if (!facts) throw new Error('mutate() needs a loaded holiday');
    const holidayId = facts.holiday.id;
    const { kind } = mutation;
    const id = mutation.kind === 'holiday' ? holidayId : mutation.id;
    const before = readItem(facts, kind, id);
    const fields: Readonly<Record<string, unknown>> = 'fields' in mutation ? mutation.fields : {};
    const label = this.#label(mutation, fields, before);
    // Members are only ever created (§5.1); everything else sends what it last read.
    const version = kind === 'members' ? 0 : (before?.version ?? 0);

    const apply = (change: (facts: HolidayFacts) => HolidayFacts) => {
      if (this.facts?.holiday.id === holidayId) this.facts = change(this.facts);
    };
    const rollback = () =>
      apply((current) =>
        before ? writeItem(current, kind, before) : dropItem(current, kind as ListKind, id)
      );

    if ('remove' in mutation) {
      apply((current) => dropItem(current, mutation.kind, id));
    } else {
      const optimistic = {
        updatedAt: '',
        updatedBy: '',
        ...before,
        ...fields,
        ...(kind === 'holiday' ? {} : { [keyField[kind]]: id }),
        version: before?.version ?? 0
      };
      apply((current) => writeItem(current, kind, optimistic));
    }

    try {
      const stored = await withRetry(
        () => this.#send(mutation, holidayId, id, version),
        this.#retry
      );
      if (stored) apply((current) => writeItem(current, kind, stored));
      return { outcome: 'saved' };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'version-conflict') {
        this.#conflict(apply, kind, id, error.current as AnyItem | null | undefined, label);
        return { outcome: 'conflict' };
      }
      if (
        error instanceof ApiError &&
        error.code === 'already-exists' &&
        version === 0 &&
        !('remove' in mutation)
      ) {
        return this.#alreadyExists(apply, rollback, kind, holidayId, id, fields, label);
      }
      rollback();
      this.#failed(error, label);
      return { outcome: 'failed', error };
    }
  }

  async #fetch(holidayId: string) {
    const seq = ++this.#fetchSeq;
    this.#lastFetch = this.#now();
    if (!this.facts) this.status = 'loading';
    try {
      const facts = await this.#api.get('/holidays/{holidayId}', { holidayId });
      if (seq !== this.#fetchSeq || holidayId !== this.holidayId) return;
      this.facts = facts;
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
    apply: (change: (facts: HolidayFacts) => HolidayFacts) => void,
    rollback: () => void,
    kind: ItemKind,
    holidayId: string,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    label: string
  ): Promise<MutationResult> {
    let stored: AnyItem | undefined;
    try {
      const fresh = await withRetry(
        () => this.#api.get('/holidays/{holidayId}', { holidayId }),
        this.#retry
      );
      stored = readItem(fresh, kind, id);
    } catch (error) {
      rollback();
      this.#failed(error, label);
      return { outcome: 'failed', error };
    }
    if (stored && matches(stored, fields)) {
      apply((current) => writeItem(current, kind, stored));
      return { outcome: 'saved' };
    }
    this.#conflict(apply, kind, id, stored ?? null, label);
    return { outcome: 'conflict' };
  }

  #conflict(
    apply: (change: (facts: HolidayFacts) => HolidayFacts) => void,
    kind: ItemKind,
    id: string,
    current: AnyItem | null | undefined,
    label: string
  ) {
    if (current) {
      apply((facts) => writeItem(facts, kind, current));
    } else if (kind !== 'holiday') {
      apply((facts) => dropItem(facts, kind, id));
    }
    const message = current ? 'mutate.conflict' : 'mutate.conflictDeleted';
    this.#toasts.error(t(message, { item: label }), {
      label: t('mutate.refreshHoliday'),
      run: () => void this.refresh()
    });
  }

  #failed(error: unknown, label: string) {
    // A 4xx has a message worth showing; retries running out (or anything else) doesn't.
    const rejected = error instanceof ApiError && !isRetryable(error);
    this.#toasts.error(
      rejected
        ? t('mutate.rejected', { item: label, message: error.message })
        : t('mutate.failed', { item: label })
    );
  }

  #label(
    mutation: Mutation,
    fields: Readonly<Record<string, unknown>>,
    before: AnyItem | undefined
  ): string {
    if (mutation.label) return mutation.label;
    const name = fields.name ?? before?.name;
    return typeof name === 'string' && name ? name : t(`mutate.items.${mutation.kind}`);
  }
}

export const holiday = new HolidayStore({ api, toasts: appToasts });
session.onSignOut(() => holiday.clear());
