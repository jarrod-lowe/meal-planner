// Fuzzy search over the catalogue and the common ingredients list
// (PHASE_3 "Fuzzy search", DESIGN §7.4). Pure TypeScript: no Svelte or DOM.
import Fuse, { type IFuseOptions } from 'fuse.js';
import type { components } from '#lib/api/types.js';
import type { ShopSection } from '#lib/model/sections.js';

type Ingredient = components['schemas']['Ingredient'];
type Recipe = components['schemas']['Recipe'];

/** An entry in `data/common-ingredients.json`. */
export interface CommonIngredient {
  name: string;
  unit: string;
  shopSection: ShopSection;
}

export interface SearchOptions {
  /** Include hidden (`deleted`) items. Off by default. */
  includeHidden?: boolean;
  /** At most this many results. */
  limit?: number;
}

/** Units offered after the ones already used for a name (PHASE_3 "Units"). */
export const COMMON_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'each',
  'can',
  'packet',
  'bottle',
  'bunch',
  'dozen'
] as const;

// Fuse scores run from 0 (exact) to 1. With `ignoreLocation`, a score is
// roughly the share of the query's letters that are wrong, at the best place in
// the name: one typo in "tomato" scores about 0.15, while "milk" against
// "mince" needs two of four letters changed (0.5). 0.3 keeps a one-letter typo
// (missing, extra or wrong) in a word of four or more letters and leaves out
// two. `ignoreLocation` matches anywhere in the name, so "thigh" finds
// "Chicken thighs". The threshold applies before Fuse's field-length norm,
// which then ranks shorter names first among equally good matches ("Tomato"
// before "Cherry tomatoes" for "tomatos").
const FUSE_OPTIONS: IFuseOptions<{ name: string }> = {
  keys: ['name'],
  threshold: 0.3,
  ignoreLocation: true,
  ignoreDiacritics: true,
  includeScore: true
};

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const normalise = (text: string) => text.trim().toLowerCase();
const nameUnitKey = (name: string, unit: string) => `${normalise(name)}\u0000${normalise(unit)}`;

// One index per array: stores replace the array when anything changes, so its
// identity is a cheap cache key, and the WeakMap lets old indexes go.
const indexes = new WeakMap<readonly object[], Fuse<object>>();

function fuseFor<T extends { name: string }>(items: readonly T[]): Fuse<T> {
  let fuse = indexes.get(items) as unknown as Fuse<T> | undefined;
  if (!fuse) {
    fuse = new Fuse<T>(items, FUSE_OPTIONS);
    indexes.set(items, fuse as unknown as Fuse<object>);
  }
  return fuse;
}

function compareNameUnit(a: { name: string; unit: string }, b: { name: string; unit: string }) {
  return collator.compare(a.name.trim(), b.name.trim()) || collator.compare(a.unit, b.unit);
}

function take<T>(items: T[], limit: number | undefined): T[] {
  return limit === undefined ? items : items.slice(0, Math.max(0, limit));
}

/**
 * Fuzzy matches by name, with items of the same name (ignoring case) kept
 * together: groups in order of their best match, each sorted by unit.
 */
function searchNameUnit<T extends { name: string; unit: string }>(
  items: readonly T[],
  query: string,
  keep: (item: T) => boolean
): T[] {
  const groups = new Map<string, { score: number; items: T[] }>();
  for (const { item, score = 0 } of fuseFor(items).search(query.trim())) {
    if (!keep(item)) continue;
    const key = normalise(item.name);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      group.score = Math.min(group.score, score);
    } else {
      groups.set(key, { score, items: [item] });
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.score - b.score || collator.compare(a.items[0]?.name ?? '', b.items[0]?.name ?? '')
    )
    .flatMap((group) => group.items.sort(compareNameUnit));
}

const visible =
  (includeHidden: boolean | undefined) =>
  (item: { deleted: boolean }): boolean =>
    includeHidden === true || !item.deleted;

/**
 * Catalogue ingredients matching `query`. An empty query returns them all,
 * sorted by name then unit.
 */
export function searchIngredients(
  ingredients: readonly Ingredient[],
  query: string,
  { includeHidden, limit }: SearchOptions = {}
): Ingredient[] {
  const keep = visible(includeHidden);
  if (query.trim() === '') {
    return take(ingredients.filter(keep).sort(compareNameUnit), limit);
  }
  return take(searchNameUnit(ingredients, query, keep), limit);
}

/**
 * Recipes matching `query`, best first. An empty query returns them all,
 * sorted by name.
 */
export function searchRecipes(
  recipes: readonly Recipe[],
  query: string,
  { includeHidden, limit }: SearchOptions = {}
): Recipe[] {
  const keep = visible(includeHidden);
  if (query.trim() === '') {
    return take(
      recipes.filter(keep).sort((a, b) => collator.compare(a.name.trim(), b.name.trim())),
      limit
    );
  }
  const results = fuseFor(recipes)
    .search(query.trim())
    .filter(({ item }) => keep(item))
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || collator.compare(a.item.name, b.item.name))
    .map(({ item }) => item);
  return take(results, limit);
}

/**
 * Common ingredients matching `query` that aren't in the catalogue yet, to
 * offer as *Add to catalogue*. An entry is left out when the catalogue has the
 * same name + unit (ignoring case and surrounding spaces), even if that item
 * is hidden: the right action then is to show it again, not to create a
 * duplicate. An empty query suggests nothing.
 */
export function suggestIngredients(
  common: readonly CommonIngredient[],
  catalogue: readonly Ingredient[],
  query: string,
  limit?: number
): CommonIngredient[] {
  if (query.trim() === '') return [];
  const existing = new Set(catalogue.map((i) => nameUnitKey(i.name, i.unit)));
  return take(
    searchNameUnit(common, query, (entry) => !existing.has(nameUnitKey(entry.name, entry.unit))),
    limit
  );
}

/**
 * Whether the catalogue already has this name + unit (ignoring case and
 * surrounding spaces), hidden items included. `exceptId` skips the item being
 * edited.
 */
export function isDuplicate(
  ingredients: readonly Ingredient[],
  name: string,
  unit: string,
  exceptId?: string
): boolean {
  return findDuplicate(ingredients, name, unit, exceptId) !== undefined;
}

/** The item {@link isDuplicate} finds, so the UI can offer to use it instead. */
export function findDuplicate(
  ingredients: readonly Ingredient[],
  name: string,
  unit: string,
  exceptId?: string
): Ingredient | undefined {
  const key = nameUnitKey(name, unit);
  return ingredients.find((i) => i.id !== exceptId && nameUnitKey(i.name, i.unit) === key);
}

/**
 * Units to suggest for a new ingredient called `name`: those the catalogue
 * already uses for that name (ignoring case, hidden items included), sorted,
 * then {@link COMMON_UNITS}, without repeats (ignoring case).
 */
export function unitSuggestions(ingredients: readonly Ingredient[], name: string): string[] {
  const wanted = normalise(name);
  const used = ingredients
    .filter((i) => normalise(i.name) === wanted)
    .map((i) => i.unit.trim())
    .sort(collator.compare);
  const seen = new Set<string>();
  const units: string[] = [];
  for (const unit of [...used, ...COMMON_UNITS]) {
    const key = unit.toLowerCase();
    if (unit === '' || seen.has(key)) continue;
    seen.add(key);
    units.push(unit);
  }
  return units;
}
