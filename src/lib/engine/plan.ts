import type {
  Catalogue,
  ConsumptionLine,
  HolidayFacts,
  Ingredient,
  LocalDateTime,
  Plan,
  Recipe,
  Warning,
  WarningCode
} from './types.js';

/** Differences smaller than this are treated as zero (DESIGN §1). */
export const EPSILON = 1e-9;

/**
 * Works out the plan from the facts (DESIGN §3). Pure: it doesn't change its
 * inputs. `now` is holiday-local.
 *
 * This slice fills `consumption` and the meal and recipe warnings; shopping
 * lists, shortfalls and stock come with phases 6 and 7.
 *
 * - `consumption` has an entry only for a mealtime with a resolvable recipe
 *   and servings > 0 (the entry may be empty if no line resolves).
 * - `mealtime-without-attendees` is given for past mealtimes too; only
 *   `meal-without-recipe` looks at `now`.
 * - `missing-ingredient` is given once per used recipe and ingredient, whether
 *   or not anyone eats the meal.
 * - Warnings are sorted by code (in `Warning` union order), then by their ids.
 */
export function plan(facts: HolidayFacts, catalogue: Catalogue, now: LocalDateTime): Plan {
  const attendeeIds = new Set(facts.attendees.map((a) => a.id));
  const recipes = new Map<string, Recipe>(catalogue.recipes.map((r) => [r.id, r]));
  const ingredients = new Map<string, Ingredient>(catalogue.ingredients.map((i) => [i.id, i]));

  const consumption = new Map<string, ConsumptionLine[]>();
  const warnings: Warning[] = [];
  const usedRecipes = new Map<string, Recipe>();

  for (const meal of facts.meals) {
    const recipe = meal.recipeId === null ? undefined : recipes.get(meal.recipeId);
    if (meal.recipeId === null) {
      if (meal.mealtimes.some((m) => m.at >= now)) {
        warnings.push({ code: 'meal-without-recipe', mealId: meal.id });
      }
    } else if (!recipe) {
      warnings.push({ code: 'missing-recipe', mealId: meal.id, recipeId: meal.recipeId });
    } else {
      usedRecipes.set(recipe.id, recipe);
    }

    for (const mealtime of meal.mealtimes) {
      const servings = new Set(mealtime.attendeeIds.filter((id) => attendeeIds.has(id))).size;
      if (servings === 0) {
        warnings.push({
          code: 'mealtime-without-attendees',
          mealId: meal.id,
          mealtimeId: mealtime.id
        });
      } else if (recipe) {
        consumption.set(mealtime.id, scale(recipe, servings / recipe.servings, ingredients));
      }
    }
  }

  for (const recipe of usedRecipes.values()) {
    for (const ingredientId of new Set(recipe.lines.map((l) => l.ingredientId))) {
      if (!ingredients.has(ingredientId)) {
        warnings.push({ code: 'missing-ingredient', ingredientId, recipeId: recipe.id });
      }
    }
  }

  return {
    consumption,
    shoppingLists: new Map(),
    shortfalls: [],
    stock: new Map(),
    warnings: warnings.sort(compareWarnings)
  };
}

/** A recipe's lines scaled by `factor`, skipping missing ingredients and summing repeats. */
function scale(
  recipe: Recipe,
  factor: number,
  ingredients: ReadonlyMap<string, Ingredient>
): ConsumptionLine[] {
  const quantities = new Map<string, number>();
  for (const line of recipe.lines) {
    if (!ingredients.has(line.ingredientId)) continue;
    const quantity = line.quantity * factor;
    quantities.set(line.ingredientId, (quantities.get(line.ingredientId) ?? 0) + quantity);
  }
  return [...quantities].map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
}

const WARNING_ORDER: readonly WarningCode[] = [
  'meal-without-recipe',
  'mealtime-without-attendees',
  'missing-recipe',
  'missing-ingredient',
  'removed-more-than-stock',
  'trip-not-finished',
  'outside-holiday-dates'
];

/** The ids a warning sorts by, after its code. */
function sortKey(w: Warning): string[] {
  switch (w.code) {
    case 'meal-without-recipe':
      return [w.mealId];
    case 'mealtime-without-attendees':
      return [w.mealId, w.mealtimeId];
    case 'missing-recipe':
      return [w.mealId, w.recipeId];
    case 'missing-ingredient':
      return [w.recipeId ?? '', w.stockChangeId ?? '', w.ingredientId];
    case 'removed-more-than-stock':
      return [w.stockChangeId, w.ingredientId];
    case 'trip-not-finished':
      return [w.tripId];
    case 'outside-holiday-dates':
      return [w.mealId ?? '', w.tripId ?? '', w.stockChangeId ?? ''];
  }
}

function compareWarnings(a: Warning, b: Warning): number {
  const byCode = WARNING_ORDER.indexOf(a.code) - WARNING_ORDER.indexOf(b.code);
  if (byCode !== 0) return byCode;
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    const x = ka[i] ?? '';
    const y = kb[i] ?? '';
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
