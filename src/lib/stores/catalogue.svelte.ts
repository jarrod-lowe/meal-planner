// The shared catalogue of recipes and ingredients (DESIGN §7.3): loaded once
// per session, refetched on focus and on Refresh, cleared on sign-out, and
// written through `mutate()`, `hide()` and `show()` on the shared write queue.
import { api, type ApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { MutationQueue, type MutationResult, type RetryOptions } from './mutation-queue.js';
import { session } from './session.svelte.js';
import { toasts as appToasts, type Toasts } from './toast.svelte.js';

export type Recipe = Schemas['Recipe'];
export type Ingredient = Schemas['Ingredient'];

/** The kinds of catalogue item, and their stored types. */
export interface CatalogueTypes {
  recipes: Recipe;
  ingredients: Ingredient;
}

export type CatalogueKind = keyof CatalogueTypes;

/** An item's own fields, `deleted` included: what the caller sets. */
export type CatalogueFields<K extends CatalogueKind> = Omit<
  CatalogueTypes[K],
  'id' | 'version' | 'updatedAt' | 'updatedBy'
>;

/** Create or update an item: it's a create when the store doesn't have it yet. */
export type CatalogueMutation = {
  readonly [K in CatalogueKind]: {
    kind: K;
    id: string;
    fields: CatalogueFields<K>;
    /** Names the item in toasts. Defaults to its `name`. */
    label?: string;
  };
}[CatalogueKind];

export type CatalogueStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogueStoreOptions extends RetryOptions {
  readonly api: ApiClient;
  readonly toasts: Toasts;
  /** Milliseconds, for the focus throttle. */
  readonly now?: () => number;
}

/** Refetch on focus no more often than this (§7.3). */
export const focusRefetchMs = 30_000;

type Item = Recipe | Ingredient;

interface Place {
  readonly kind: CatalogueKind;
  readonly id: string;
}

/** What the queue sends: a PUT of the fields, or a DELETE that hides the item. */
type Request = CatalogueMutation | { readonly kind: CatalogueKind; readonly hide: true };

interface Lists {
  readonly recipes: readonly Recipe[];
  readonly ingredients: readonly Ingredient[];
}

function find(lists: Lists, kind: CatalogueKind, id: string): Item | undefined {
  return (lists[kind] as readonly Item[]).find((item) => item.id === id);
}

/** `lists` with the item replaced, added, or (when `undefined`) removed. */
function put(lists: Lists, kind: CatalogueKind, id: string, item: Item | undefined): Lists {
  const list = lists[kind] as readonly Item[];
  const at = list.findIndex((existing) => existing.id === id);
  let next: readonly Item[];
  if (!item) next = at === -1 ? list : list.toSpliced(at, 1);
  else next = at === -1 ? [...list, item] : list.with(at, item);
  return { ...lists, [kind]: next };
}

/** Set by the store or the server, never sent in a body. */
const storeFields: readonly string[] = ['id', 'version', 'updatedAt', 'updatedBy'];

/** The fields a PUT sends, from a stored (or shown) item. */
function fieldsOf(item: Item): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(item).filter(([name]) => !storeFields.includes(name)));
}

export class CatalogueStore {
  /** Every recipe, hidden ones included. */
  recipes = $state.raw<readonly Recipe[]>([]);
  /** Every ingredient, hidden ones included. */
  ingredients = $state.raw<readonly Ingredient[]>([]);
  status = $state<CatalogueStatus>('idle');
  /** Why the first load failed. */
  error = $state.raw<unknown>(null);

  readonly #api: ApiClient;
  readonly #toasts: Toasts;
  readonly #now: () => number;
  #fetching: Promise<void> | undefined;
  #fetchSeq = 0;
  #lastFetch = Number.NEGATIVE_INFINITY;
  /** Write bookkeeping; the lists are what views read. Reset by `clear()` (sign-out). */
  readonly #queue: MutationQueue<Place, Item, Request>;

  constructor(options: CatalogueStoreOptions) {
    this.#api = options.api;
    this.#toasts = options.toasts;
    this.#now = options.now ?? Date.now;
    this.#queue = new MutationQueue({
      toasts: options.toasts,
      delays: options.delays,
      sleep: options.sleep,
      refresh: { label: () => t('mutate.refreshCatalogue'), run: () => void this.refresh() },
      hooks: {
        apply: ({ context }, item, write) =>
          ({
            updatedAt: '',
            updatedBy: '',
            ...item,
            ...write.fields,
            id: context.id,
            version: item?.version ?? 0
          }) as Item,
        show: ({ context }, item) =>
          this.#setLists(put(this.#lists(), context.kind, context.id, item)),
        send: ({ context }, write, version) => this.#send(write.mutation, context, version),
        fetchStored: async ({ context }) =>
          find(await this.#api.get('/catalogue'), context.kind, context.id)
      }
    });
  }

  /** Loads the catalogue, once per session: later calls do nothing (use `refresh()` to refetch). */
  load(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    return this.refresh();
  }

  /** Refetches the catalogue; concurrent calls share one request. */
  refresh(): Promise<void> {
    this.#fetching ??= this.#fetch().finally(() => (this.#fetching = undefined));
    return this.#fetching;
  }

  /** Refetches if it has loaded and the last fetch was at least 30 s ago. */
  refetchIfStale() {
    if (this.status !== 'idle' && this.#now() - this.#lastFetch >= focusRefetchMs) {
      void this.refresh();
    }
  }

  /** Refetches on the target's `focus` events (the window, by default). Returns a detach. */
  attachFocusRefetch(target: EventTarget = window): () => void {
    const onFocus = () => this.refetchIfStale();
    target.addEventListener('focus', onFocus);
    return () => target.removeEventListener('focus', onFocus);
  }

  /** Forgets the catalogue and abandons its writes, on sign-out. */
  clear() {
    this.#queue.reset();
    this.#fetchSeq++;
    this.#fetching = undefined;
    this.recipes = [];
    this.ingredients = [];
    this.error = null;
    this.status = 'idle';
    this.#lastFetch = Number.NEGATIVE_INFINITY;
  }

  /**
   * Creates or updates a recipe or ingredient (§7.3): applies it at once,
   * sends it with the item's version, then keeps the server's copy. Conflicts,
   * retries, rollbacks, queueing and sign-out work as in the holiday store
   * (see `MutationQueue`).
   */
  async mutate(mutation: CatalogueMutation): Promise<MutationResult> {
    this.#requireLoaded();
    return this.#enqueue(mutation, mutation.id, mutation.fields, mutation.label);
  }

  /**
   * Hides an item: shows `deleted: true` at once and sends `DELETE`. The
   * DELETE answers 204 with no body, but it bumps the stored version (unless
   * the item was already hidden). So once it succeeds, the same queued step
   * fetches `GET /catalogue` for the stored copy, and a show-again queued
   * behind it sends the right version. The DELETE is idempotent, so if that
   * fetch fails, the retry sends both again.
   */
  async hide(kind: CatalogueKind, id: string): Promise<MutationResult> {
    this.#shown(kind, id);
    return this.#enqueue({ kind, hide: true }, id, { deleted: true });
  }

  /** Shows a hidden item again: a PUT of its fields with `deleted: false`. */
  async show(kind: CatalogueKind, id: string): Promise<MutationResult> {
    const item = this.#shown(kind, id);
    const fields = { ...fieldsOf(item), deleted: false } as CatalogueFields<typeof kind>;
    return this.#enqueue({ kind, id, fields } as CatalogueMutation, id, fields);
  }

  #requireLoaded() {
    if (this.status !== 'ready') throw new Error('catalogue writes need a loaded catalogue');
  }

  /** The item as shown; hiding or showing one the store doesn't have is a bug. */
  #shown(kind: CatalogueKind, id: string): Item {
    this.#requireLoaded();
    const item = find(this, kind, id);
    if (!item) throw new Error(`no ${kind} item ${id}`);
    return item;
  }

  #enqueue(
    request: Request,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    label?: string
  ): Promise<MutationResult> {
    const { kind } = request;
    const shown = find(this, kind, id);
    return this.#queue.enqueue(`${kind} ${id}`, { kind, id }, shown, {
      mutation: request,
      fields,
      remove: false,
      label: this.#label(kind, fields, shown, label),
      existed: shown !== undefined
    });
  }

  // A plain copy: in the browser build, `$state` fields are accessors, so spreading `this` would drop them.
  #lists(): Lists {
    return { recipes: this.recipes, ingredients: this.ingredients };
  }

  #setLists(lists: Lists) {
    if (lists.recipes !== this.recipes) this.recipes = lists.recipes;
    if (lists.ingredients !== this.ingredients) this.ingredients = lists.ingredients;
  }

  /** As in the holiday store: items written while the fetch was out keep what the store shows. */
  async #fetch() {
    const seq = ++this.#fetchSeq;
    this.#queue.fetchStarted();
    this.#lastFetch = this.#now();
    if (this.status !== 'ready') this.status = 'loading';
    try {
      const fetched = await this.#api.get('/catalogue');
      if (seq !== this.#fetchSeq) return;
      let next: Lists = fetched;
      for (const { context } of this.#queue.written()) {
        next = put(next, context.kind, context.id, find(this, context.kind, context.id));
      }
      this.recipes = next.recipes;
      this.ingredients = next.ingredients;
      this.error = null;
      this.status = 'ready';
    } catch (error) {
      if (seq !== this.#fetchSeq) return;
      if (this.status === 'ready') {
        this.#toasts.error(t('catalogue.refreshFailed'));
      } else {
        this.error = error;
        this.status = 'error';
      }
    }
  }

  /** One attempt at the request. Resolves with the stored item. */
  async #send(request: Request, place: Place, version: number): Promise<Item | undefined> {
    const api = this.#api;
    const { kind, id } = place;
    if ('hide' in request) {
      if (kind === 'recipes') await api.del('/catalogue/recipes/{id}', { id });
      else await api.del('/catalogue/ingredients/{id}', { id });
      return find(await api.get('/catalogue'), kind, id);
    }
    if (request.kind === 'recipes') {
      return api.put('/catalogue/recipes/{id}', { id }, { ...request.fields, version });
    }
    return api.put('/catalogue/ingredients/{id}', { id }, { ...request.fields, version });
  }

  #label(
    kind: CatalogueKind,
    fields: Readonly<Record<string, unknown>>,
    shown: Item | undefined,
    label: string | undefined
  ): string {
    if (label) return label;
    const name = fields.name ?? shown?.name;
    return typeof name === 'string' && name ? name : t(`mutate.items.${kind}`);
  }
}

export const catalogue = new CatalogueStore({ api, toasts: appToasts });
session.onSignOut(() => catalogue.clear());
