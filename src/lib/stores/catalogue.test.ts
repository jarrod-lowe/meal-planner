import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { CatalogueStore } from './catalogue.svelte.js';
import { CancelledError, type MutationResult } from './mutation-queue.js';
import { Toasts } from './toast.svelte.js';

type Recipe = Schemas['Recipe'];
type Ingredient = Schemas['Ingredient'];

const flourId = '0190a0b0-0000-7000-8000-0000000000f1';
const eggsId = '0190a0b0-0000-7000-8000-0000000000e1';
const pancakesId = '0190a0b0-0000-7000-8000-0000000000c1';
const meta = { updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-1' };

const flour = (): Ingredient => ({
  id: flourId,
  name: 'Flour',
  unit: 'g',
  shopSection: 'pantry',
  deleted: false,
  version: 2,
  ...meta
});
const pancakes = (): Recipe => ({
  id: pancakesId,
  name: 'Pancakes',
  servings: 4,
  lines: [{ ingredientId: flourId, quantity: 200 }],
  notes: '',
  deleted: false,
  version: 1,
  ...meta
});
const catalogue = () => ({ recipes: [pancakes()], ingredients: [flour()] });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

type Reply = Response | Error | Promise<Response>;

/** A fake API behind a real client, as in holiday.test.ts. */
function setup(options: { sleep?: (ms: number) => Promise<void> } = {}) {
  const queues = new Map<string, Reply[]>();
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    requests.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    });
    const reply = queues.get(`${method} ${path}`)?.shift();
    if (!reply) return Promise.reject(new Error(`unexpected ${method} ${path}`));
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  const reply = (key: string, ...replies: Reply[]) => {
    queues.set(key, [...(queues.get(key) ?? []), ...replies]);
  };

  let clock = 1_000_000;
  const sleeps: number[] = [];
  const toasts = new Toasts();
  const store = new CatalogueStore({
    api: createApiClient({ fetch, token: () => Promise.resolve('token') }),
    toasts,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      return options.sleep?.(ms) ?? Promise.resolve();
    }
  });
  const tick = (ms: number) => (clock += ms);
  const writes = () => requests.filter((r) => r.method !== 'GET');

  return { store, toasts, reply, requests, writes, sleeps, tick };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  env.reply('GET /catalogue', json(200, catalogue()));
  await env.store.load();
  return env;
}

function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

const ingredientPath = (id: string) => `/catalogue/ingredients/${id}`;
const recipePath = (id: string) => `/catalogue/recipes/${id}`;
/** An item without what the store or server sets: the fields a PUT sends. */
const strip = (item: object, keep: readonly string[] = []) =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => keep.includes(name) || !['id', 'version', 'updatedAt', 'updatedBy'].includes(name)
    )
  );
const flourFields = strip(flour()) as Omit<
  Ingredient,
  'id' | 'version' | 'updatedAt' | 'updatedBy'
>;

describe('CatalogueStore loading', () => {
  it('loads every recipe and ingredient, hidden ones included', async () => {
    const env = setup();
    const hidden = { ...flour(), id: eggsId, name: 'Eggs', deleted: true };
    env.reply(
      'GET /catalogue',
      json(200, { recipes: [pancakes()], ingredients: [flour(), hidden] })
    );
    expect(env.store.status).toBe('idle');

    const loading = env.store.load();
    expect(env.store.status).toBe('loading');
    await loading;

    expect(env.store.status).toBe('ready');
    expect(env.store.recipes).toEqual([pancakes()]);
    expect(env.store.ingredients).toEqual([flour(), hidden]);
  });

  it('loads once per session', async () => {
    const { store, requests } = await loaded();

    await store.load();
    await store.load();

    expect(requests).toHaveLength(1);
  });

  it('shares one request between concurrent loads', async () => {
    const { store, reply, requests } = setup();
    reply('GET /catalogue', json(200, catalogue()));

    await Promise.all([store.load(), store.load()]);

    expect(requests).toHaveLength(1);
  });

  it('keeps a first load error, and loads again when asked', async () => {
    const { store, reply } = setup();
    reply('GET /catalogue', json(500, { error: { code: 'internal', message: 'x' } }));

    await store.load();
    expect(store.status).toBe('error');
    expect(store.error).toMatchObject({ status: 500 });

    reply('GET /catalogue', json(200, catalogue()));
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.error).toBeNull();
  });

  it('refreshes on demand', async () => {
    const { store, reply } = await loaded();
    reply('GET /catalogue', json(200, { ...catalogue(), recipes: [] }));

    await store.refresh();

    expect(store.recipes).toEqual([]);
  });

  it('keeps what it has and toasts when a refresh fails', async () => {
    const { store, reply, toasts } = await loaded();
    reply('GET /catalogue', new TypeError('offline'));

    await store.refresh();

    expect(store.status).toBe('ready');
    expect(store.ingredients).toEqual([flour()]);
    expect(toasts.items.map((toast) => toast.message)).toEqual([t('catalogue.refreshFailed')]);
  });
});

describe('CatalogueStore focus refetch', () => {
  it('refetches on focus at most once every 30 s', async () => {
    const { store, reply, requests, tick } = await loaded();
    reply('GET /catalogue', json(200, catalogue()), json(200, catalogue()));
    const target = new EventTarget();
    const detach = store.attachFocusRefetch(target);

    tick(29_999);
    target.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(requests).toHaveLength(1);

    tick(1);
    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    tick(10_000);
    target.dispatchEvent(new Event('focus'));
    tick(30_000);
    detach();
    target.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(requests).toHaveLength(2);
  });

  it('does nothing on focus before the first load', () => {
    const { store, requests } = setup();
    const target = new EventTarget();
    store.attachFocusRefetch(target);

    target.dispatchEvent(new Event('focus'));

    expect(requests).toEqual([]);
  });
});

describe('CatalogueStore.mutate', () => {
  it('creates an ingredient with version 0', async () => {
    const { store, reply, writes } = await loaded();
    const fields = { name: 'Eggs', unit: 'each', shopSection: 'dairy', deleted: false } as const;
    const stored = { id: eggsId, ...fields, version: 1, ...meta };
    const pending = deferred();
    reply(`PUT ${ingredientPath(eggsId)}`, pending.promise);

    const result = store.mutate({ kind: 'ingredients', id: eggsId, fields });

    expect(store.ingredients.at(-1)).toMatchObject({ id: eggsId, name: 'Eggs', version: 0 });
    pending.resolve(json(200, stored));
    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(writes()[0]).toEqual({
      method: 'PUT',
      path: ingredientPath(eggsId),
      body: { ...fields, version: 0 }
    });
    expect(store.ingredients).toEqual([flour(), stored]);
  });

  it('updates a recipe with its version', async () => {
    const { store, reply, writes } = await loaded();
    const fields = strip(pancakes()) as Omit<Recipe, 'id' | 'version' | 'updatedAt' | 'updatedBy'>;
    const stored = { ...pancakes(), servings: 6, version: 2 };
    reply(`PUT ${recipePath(pancakesId)}`, json(200, stored));

    const result = store.mutate({
      kind: 'recipes',
      id: pancakesId,
      fields: { ...fields, servings: 6 }
    });
    expect(store.recipes[0]?.servings).toBe(6);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(writes()[0]?.body).toEqual({ ...fields, servings: 6, version: 1 });
    expect(store.recipes).toEqual([stored]);
  });

  it('names the item on a conflict, keeps the current copy, and offers a refresh', async () => {
    const { store, reply, toasts, requests } = await loaded();
    const current = { ...flour(), unit: 'kg', version: 5 };
    reply(
      `PUT ${ingredientPath(flourId)}`,
      json(409, { error: { code: 'version-conflict', message: 'x' }, current })
    );

    const result = await store.mutate({
      kind: 'ingredients',
      id: flourId,
      fields: { ...flourFields, unit: 'kg' }
    });

    expect(result).toEqual({ outcome: 'conflict' });
    expect(store.ingredients).toEqual([current]);
    const [toast] = toasts.items;
    expect(toast?.message).toBe(t('mutate.conflict', { item: 'Flour' }));
    expect(toast?.action?.label).toBe(t('mutate.refreshCatalogue'));

    reply('GET /catalogue', json(200, catalogue()));
    toasts.act(toast?.id ?? 0);
    await vi.waitFor(() => expect(requests.at(-1)?.path).toBe('/catalogue'));
  });

  it('retries, then rolls back with a toast', async () => {
    const { store, reply, toasts } = await loaded();
    const offline = () => new TypeError('offline');
    reply(`PUT ${ingredientPath(flourId)}`, offline(), offline(), offline(), offline());

    const result = await store.mutate({
      kind: 'ingredients',
      id: flourId,
      fields: { ...flourFields, name: 'Plain flour' }
    });

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(store.ingredients).toEqual([flour()]);
    expect(toasts.items.map((toast) => toast.message)).toEqual([
      t('mutate.failed', { item: 'Plain flour' })
    ]);
  });

  it('treats an already-exists create that matches as saved (§5.3)', async () => {
    const { store, reply } = await loaded();
    const fields = { name: 'Eggs', unit: 'each', shopSection: 'dairy', deleted: false } as const;
    const stored = { id: eggsId, ...fields, version: 1, ...meta };
    reply(
      `PUT ${ingredientPath(eggsId)}`,
      new TypeError('timeout'),
      json(409, { error: { code: 'already-exists', message: 'exists' } })
    );
    reply('GET /catalogue', json(200, { ...catalogue(), ingredients: [flour(), stored] }));

    await expect(store.mutate({ kind: 'ingredients', id: eggsId, fields })).resolves.toEqual({
      outcome: 'saved'
    });
    expect(store.ingredients).toEqual([flour(), stored]);
  });

  it('keeps a write that lands while a stale refresh is in flight', async () => {
    const { store, reply } = await loaded();
    const slow = deferred();
    reply('GET /catalogue', slow.promise);
    const renamed = { ...flour(), name: 'Plain flour', version: 3 };
    reply(`PUT ${ingredientPath(flourId)}`, json(200, renamed));

    const refreshing = store.refresh();
    await store.mutate({
      kind: 'ingredients',
      id: flourId,
      fields: { ...flourFields, name: 'Plain flour' }
    });
    slow.resolve(json(200, { ...catalogue(), recipes: [] }));
    await refreshing;

    expect(store.ingredients).toEqual([renamed]);
    expect(store.recipes).toEqual([]);
  });

  it('refuses to mutate before the catalogue has loaded', async () => {
    const { store } = setup();

    await expect(
      store.mutate({ kind: 'ingredients', id: flourId, fields: flourFields })
    ).rejects.toThrow();
  });
});

describe('CatalogueStore hide and show', () => {
  it('hides an item optimistically with DELETE, then takes the stored copy', async () => {
    const { store, reply, requests } = await loaded();
    const pending = deferred();
    reply(`DELETE ${ingredientPath(flourId)}`, pending.promise);
    const hidden = { ...flour(), deleted: true, version: 3 };
    reply('GET /catalogue', json(200, { ...catalogue(), ingredients: [hidden] }));

    const result = store.hide('ingredients', flourId);
    expect(store.ingredients).toEqual([{ ...flour(), deleted: true }]);

    pending.resolve(noContent());
    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(requests.slice(1).map((r) => `${r.method} ${r.path}`)).toEqual([
      `DELETE ${ingredientPath(flourId)}`,
      'GET /catalogue'
    ]);
    expect(store.ingredients).toEqual([hidden]);
  });

  it('shows an item again with a PUT of deleted: false', async () => {
    const { store, reply, writes } = await loaded();
    const hiddenRecipe = { ...pancakes(), deleted: true, version: 4 };
    reply('GET /catalogue', json(200, { ...catalogue(), recipes: [hiddenRecipe] }));
    await store.refresh();
    const shown = { ...pancakes(), version: 5 };
    reply(`PUT ${recipePath(pancakesId)}`, json(200, shown));

    const result = store.show('recipes', pancakesId);
    expect(store.recipes[0]?.deleted).toBe(false);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    const body = strip({ ...pancakes(), version: 4 }, ['version']);
    expect(writes()[0]?.body).toEqual(body);
    expect(store.recipes).toEqual([shown]);
  });

  it('shows again right after a hide, with the version the hide left', async () => {
    const { store, reply, writes, toasts } = await loaded();
    reply(`DELETE ${ingredientPath(flourId)}`, noContent());
    // Someone else edited it meanwhile too, so the server's version isn't just ours + 1.
    const hidden = { ...flour(), deleted: true, version: 7 };
    reply('GET /catalogue', json(200, { ...catalogue(), ingredients: [hidden] }));
    const shown = { ...flour(), version: 8 };
    reply(`PUT ${ingredientPath(flourId)}`, json(200, shown));

    const hiding = store.hide('ingredients', flourId);
    const showing = store.show('ingredients', flourId);
    expect(store.ingredients[0]?.deleted).toBe(false);

    await expect(hiding).resolves.toEqual({ outcome: 'saved' });
    await expect(showing).resolves.toEqual({ outcome: 'saved' });
    expect(writes().map((r) => [r.method, r.body])).toEqual([
      ['DELETE', undefined],
      ['PUT', { ...flourFields, deleted: false, version: 7 }]
    ]);
    expect(store.ingredients).toEqual([shown]);
    expect(toasts.items).toEqual([]);
  });

  it('retries a hide whose follow-up fetch fails, since DELETE is idempotent', async () => {
    const { store, reply, writes } = await loaded();
    reply(`DELETE ${ingredientPath(flourId)}`, noContent(), noContent());
    const hidden = { ...flour(), deleted: true, version: 3 };
    reply(
      'GET /catalogue',
      new TypeError('offline'),
      json(200, { ...catalogue(), ingredients: [hidden] })
    );

    await expect(store.hide('ingredients', flourId)).resolves.toEqual({ outcome: 'saved' });
    expect(writes()).toHaveLength(2);
    expect(store.ingredients).toEqual([hidden]);
  });

  it('rolls back a failed hide', async () => {
    const { store, reply, toasts } = await loaded();
    reply(
      `DELETE ${ingredientPath(flourId)}`,
      json(404, { error: { code: 'not-found', message: 'gone' } })
    );

    await expect(store.hide('ingredients', flourId)).resolves.toMatchObject({
      outcome: 'failed'
    });
    expect(store.ingredients).toEqual([flour()]);
    expect(toasts.items[0]?.message).toBe(t('mutate.rejected', { item: 'Flour', message: 'gone' }));
  });

  it('refuses to hide or show an item it does not have', async () => {
    const { store } = await loaded();

    await expect(store.hide('ingredients', eggsId)).rejects.toThrow();
    await expect(store.show('recipes', eggsId)).rejects.toThrow();
  });
});

describe('CatalogueStore after clear (sign-out)', () => {
  const expectCancelled = async (result: Promise<MutationResult>) => {
    const settled = await result;
    expect(settled.outcome).toBe('failed');
    expect(settled.outcome === 'failed' && settled.error).toBeInstanceOf(CancelledError);
  };

  it('forgets everything, and loads again for the next user', async () => {
    const { store, reply, requests } = await loaded();

    store.clear();

    expect(store.status).toBe('idle');
    expect(store.recipes).toEqual([]);
    expect(store.ingredients).toEqual([]);
    reply('GET /catalogue', json(200, catalogue()));
    await store.load();
    expect(requests).toHaveLength(2);
  });

  it('abandons pending writes, sending and applying nothing more', async () => {
    const { store, reply, writes, toasts } = await loaded();
    const pending = deferred();
    reply(`PUT ${ingredientPath(flourId)}`, pending.promise);

    const renaming = store.mutate({
      kind: 'ingredients',
      id: flourId,
      fields: { ...flourFields, name: 'Plain flour' }
    });
    const hiding = store.hide('ingredients', flourId);
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    store.clear();
    pending.resolve(json(200, { ...flour(), name: 'Plain flour', version: 3 }));

    await expectCancelled(renaming);
    await expectCancelled(hiding);
    expect(writes()).toHaveLength(1);
    expect(store.ingredients).toEqual([]);
    expect(toasts.items).toEqual([]);
  });

  it('ignores a load that returns after clear', async () => {
    const { store, reply } = setup();
    const slow = deferred();
    reply('GET /catalogue', slow.promise);

    const loading = store.load();
    store.clear();
    slow.resolve(json(200, catalogue()));
    await loading;

    expect(store.status).toBe('idle');
    expect(store.recipes).toEqual([]);
  });
});
