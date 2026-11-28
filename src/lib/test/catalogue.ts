// A loaded `CatalogueStore` behind a fake API, and item builders, for component tests.
import type { Schemas } from '#lib/api/client.js';
import { CatalogueStore } from '#lib/stores/catalogue.svelte.js';
import { Toasts } from '#lib/stores/toast.svelte.js';
import { fakeApi, json, meta, type SentRequest } from './api.js';

export { apiError, json, meta, type SentRequest } from './api.js';

type Ingredient = Schemas['Ingredient'];
type Recipe = Schemas['Recipe'];

export const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let next = 0;
const testId = () => `0190a0b0-0000-7000-8000-${String(++next).padStart(12, '0')}`;

export function ingredient(
  name: string,
  unit: string,
  overrides: Partial<Ingredient> = {}
): Ingredient {
  return {
    id: testId(),
    name,
    unit,
    shopSection: 'pantry',
    deleted: false,
    version: 1,
    ...meta,
    ...overrides
  };
}

export function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: testId(),
    name,
    servings: 4,
    lines: [],
    notes: '',
    deleted: false,
    version: 1,
    ...meta,
    ...overrides
  };
}

/** Echoes a PUT back as the stored item, at the next version. */
export const stored = (request: SentRequest) => {
  const { version, ...fields } = request.body as { version: number };
  return json(200, {
    ...fields,
    id: request.path.split('/').at(-1),
    version: version + 1,
    ...meta
  });
};

/** A store loaded with `initial`. Queue replies per `METHOD /path` (without `/api`). */
export async function loadedCatalogue(
  initial: { recipes?: Recipe[]; ingredients?: Ingredient[] } = {}
) {
  const { api, reply, requests } = fakeApi();
  const toasts = new Toasts();
  const store = new CatalogueStore({ api, toasts, sleep: () => Promise.resolve() });
  reply('GET /catalogue', json(200, { recipes: [], ingredients: [], ...initial }));
  await store.load();
  requests.length = 0;
  const writes = () => requests.filter((r) => r.method !== 'GET');
  return { store, toasts, reply, requests, writes };
}
