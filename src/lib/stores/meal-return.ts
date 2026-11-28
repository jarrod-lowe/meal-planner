// Where the recipe editor goes back to when it was opened from a meal
// (PHASE_4 "Create a recipe from the meal editor").
import { safeNext } from './safe-next.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const mealEditor = new RegExp(`^/holidays/${uuid}/meals/(?:new|${uuid})$`, 'iu');
const probeOrigin = 'https://same-origin.invalid';

/**
 * `path` if it's a meal editor in this app (`/holidays/<id>/meals/<id|new>`,
 * with an optional query), or `null`.
 */
export function mealReturn(path: string | null): string | null {
  if (path === null || safeNext(path) !== path) return null;
  const url = new URL(path, probeOrigin);
  if (url.hash !== '' || !mealEditor.test(url.pathname)) return null;
  return path;
}

/** The meal editor at `path`, told to use the recipe `recipeId`. */
export function withRecipe(path: string, recipeId: string): string {
  const url = new URL(path, probeOrigin);
  url.searchParams.set('recipe', recipeId);
  return url.pathname + url.search;
}

/** The meal editor at `path`, without the `recipe` it was told to use. */
export function withoutRecipe(path: string): string {
  const url = new URL(path, probeOrigin);
  url.searchParams.delete('recipe');
  return url.pathname + url.search;
}
