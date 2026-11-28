// The open holiday's facts (DESIGN §7.3): loading, refetch on focus and on
// Refresh, and `mutate()`, which every holiday write goes through. The write
// queue itself is in `mutation-queue.ts`.
import { api, type ApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { MutationQueue, type MutationResult, type RetryOptions } from './mutation-queue.js';
import { session } from './session.svelte.js';
import { toasts as appToasts, type Toasts } from './toast.svelte.js';

export {
  CancelledError,
  withRetry,
  type MutationResult,
  type RetryCall,
  type RetryOptions
} from './mutation-queue.js';

export type HolidayFacts = Schemas['HolidayFacts'];

/** The kinds of item `mutate()` writes, and their stored types. Later phases add trips and stock changes. */
export interface ItemTypes {
  holiday: Schemas['Holiday'];
  attendees: Schemas['Attendee'];
  members: Schemas['Member'];
  meals: Schemas['Meal'];
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
  readonly [K in ListKind]: Common & {
    kind: K;
    id: string;
    fields: Fields<K>;
    /**
     * The version the caller's copy was read at (a form seeded from the
     * store), sent exactly as given instead of the confirmed version: if the
     * item changed since, the server answers with a version conflict rather
     * than taking the stale copy. As in the catalogue store.
     */
    expectedVersion?: number;
  };
}[ListKind];
export type Remove = {
  readonly [K in ListKind]: Common & { kind: K; id: string; remove: true };
}[ListKind];
/** Update the open holiday's META. */
export type SaveHoliday = Common & { kind: 'holiday'; fields: Fields<'holiday'> };

export type Mutation = Save | Remove | SaveHoliday;

export type HolidayStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HolidayStoreOptions extends RetryOptions {
  readonly api: ApiClient;
  readonly toasts: Toasts;
  /** Milliseconds, for the focus throttle. */
  readonly now?: () => number;
}

/** Refetch on focus no more often than this (§7.3). */
export const focusRefetchMs = 30_000;

type AnyItem = { version: number } & Record<string, unknown>;

/** Where a queued item lives. */
interface Place {
  readonly holidayId: string;
  readonly kind: ItemKind;
  readonly id: string;
}

/** Which field identifies an item in each list. */
const keyField: Readonly<Record<ListKind, 'id' | 'userSub'>> = {
  attendees: 'id',
  members: 'userSub',
  meals: 'id'
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

export class HolidayStore {
  facts = $state.raw<HolidayFacts | null>(null);
  holidayId = $state<string | null>(null);
  status = $state<HolidayStatus>('idle');
  /** Why the last load failed (`ApiError` for 403/404 pages, or `NetworkError`). */
  error = $state.raw<unknown>(null);

  readonly #api: ApiClient;
  readonly #toasts: Toasts;
  readonly #now: () => number;
  #fetching: Promise<void> | undefined;
  #fetchSeq = 0;
  #lastFetch = Number.NEGATIVE_INFINITY;
  /**
   * Write bookkeeping; `facts` is what views read. Reset by `clear()`
   * (sign-out) and by opening another holiday, which abandons every write.
   */
  readonly #queue: MutationQueue<Place, AnyItem, Mutation>;

  constructor(options: HolidayStoreOptions) {
    this.#api = options.api;
    this.#toasts = options.toasts;
    this.#now = options.now ?? Date.now;
    this.#queue = new MutationQueue({
      toasts: options.toasts,
      delays: options.delays,
      sleep: options.sleep,
      refresh: { label: () => t('mutate.refreshHoliday'), run: () => void this.refresh() },
      hooks: {
        apply: ({ context }, item, write) => ({
          updatedAt: '',
          updatedBy: '',
          ...item,
          ...write.fields,
          ...(context.kind === 'holiday' ? {} : { [keyField[context.kind]]: context.id }),
          version: item?.version ?? 0
        }),
        show: ({ context }, item) => {
          if (this.facts?.holiday.id !== context.holidayId) return;
          this.facts = putItem(this.facts, context.kind, context.id, item);
        },
        send: ({ context }, write, version) => this.#send(write.mutation, context, version),
        fetchStored: async ({ context }) => {
          const { holidayId } = context;
          const fresh = await this.#api.get('/holidays/{holidayId}', { holidayId });
          return readItem(fresh, context.kind, context.id);
        },
        // Members are only ever created (§5.1); everything else sends the version the server last gave.
        version: ({ context }, { mutation }) => {
          if (context.kind === 'members') return 0;
          return 'expectedVersion' in mutation ? mutation.expectedVersion : undefined;
        },
        // A conflict never removes the META.
        canVanish: ({ context }) => context.kind !== 'holiday'
      }
    });
  }

  /** Opens a holiday and fetches its facts. */
  load(holidayId: string): Promise<void> {
    if (holidayId !== this.holidayId) {
      this.#queue.reset();
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
    this.#queue.reset();
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
   * back with a toast; other errors roll back at once. Writes on the same
   * item are queued, one at a time (see `MutationQueue`).
   *
   * Signing out (`clear()`) or opening another holiday abandons every write:
   * nothing more is sent or applied, and each resolves `failed` with a
   * `CancelledError` and no toast.
   */
  async mutate(mutation: Mutation): Promise<MutationResult> {
    const facts = this.facts;
    if (!facts) throw new Error('mutate() needs a loaded holiday');
    const holidayId = facts.holiday.id;
    const { kind } = mutation;
    const id = mutation.kind === 'holiday' ? holidayId : mutation.id;
    const shown = readItem(facts, kind, id);
    const fields: Readonly<Record<string, unknown>> = 'fields' in mutation ? mutation.fields : {};
    return this.#queue.enqueue(`${holidayId} ${kind} ${id}`, { holidayId, kind, id }, shown, {
      mutation,
      fields,
      remove: 'remove' in mutation,
      label: this.#label(mutation, fields, shown),
      existed: shown !== undefined
    });
  }

  /**
   * A write that started or settled while a fetch was out may be missing from
   * its response. So the response replaces every item except those: they
   * keep what the store shows, which is the server's copy from the write's
   * own response with any pending writes applied.
   */
  async #fetch(holidayId: string) {
    const seq = ++this.#fetchSeq;
    this.#queue.fetchStarted();
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
    for (const { context } of this.#queue.written()) {
      if (context.holidayId !== local.holiday.id) continue;
      next = putItem(next, context.kind, context.id, readItem(local, context.kind, context.id));
    }
    return next;
  }

  /** One attempt at the request. Resolves with the stored item, or `undefined` for a delete. */
  async #send(mutation: Mutation, place: Place, version: number): Promise<AnyItem | undefined> {
    const api = this.#api;
    const { holidayId, id } = place;
    if ('remove' in mutation) {
      if (mutation.kind === 'attendees') {
        await api.del('/holidays/{holidayId}/attendees/{id}', { holidayId, id });
      } else if (mutation.kind === 'meals') {
        await api.del('/holidays/{holidayId}/meals/{id}', { holidayId, id });
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
      case 'meals':
        return api.put(
          '/holidays/{holidayId}/meals/{id}',
          { holidayId, id },
          { ...mutation.fields, version }
        );
    }
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
