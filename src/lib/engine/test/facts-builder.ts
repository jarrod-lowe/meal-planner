// Builds engine inputs in a few lines, for engine tests (DESIGN §10).
//
//   const b = factsBuilder();
//   const [ann, bob] = b.attendees('Ann', 'Bob');
//   const mince = b.ingredient('Mince', 'g', 'meat-fish');
//   const recipe = b.recipe('Bolognese', 4, [[mince, 500]]);
//   const meal = b.meal({ slot: 'dinner', at: '2027-01-01T18:30', recipe, eaters: [ann, bob] });
//   const { facts, catalogue } = b.build();
//
// Ids are deterministic and sort in the order they were minted. Use `b.id()`
// for a reference to something that doesn't exist (a deleted attendee,
// recipe or ingredient).
import type { MealSlot } from '#lib/model/slots.js';
import type { ShopSection } from '#lib/model/sections.js';
import type {
  Attendee,
  Catalogue,
  HolidayFacts,
  Ingredient,
  LocalDateTime,
  Meal,
  Recipe
} from '../types.js';

const meta = { version: 1, updatedAt: '2027-01-01T00:00:00Z', updatedBy: 'test-user' };

export interface HolidayOptions {
  startDate?: string;
  endDate?: string;
  timeZone?: string;
}

export interface MealOptions {
  slot: MealSlot;
  /** Defaults to `"<first at> <slot>"`. */
  name?: string;
  /** One mealtime at this time, or one per entry in `ats`. */
  at?: LocalDateTime;
  ats?: LocalDateTime[];
  /** A recipe id (existing or not), or none. */
  recipe?: string | null;
  /** Attendee ids for every mealtime. */
  eaters?: string[];
}

export function factsBuilder(options: HolidayOptions = {}) {
  let next = 0;
  const id = () => `00000000-0000-7000-8000-${String(++next).padStart(12, '0')}`;

  const holiday = {
    id: id(),
    name: 'Test holiday',
    timeZone: options.timeZone ?? 'Pacific/Auckland',
    startDate: options.startDate ?? '2027-01-01',
    endDate: options.endDate ?? '2027-01-07',
    ...meta
  };
  const attendees: Attendee[] = [];
  const meals: Meal[] = [];
  const recipes: Recipe[] = [];
  const ingredients: Ingredient[] = [];
  const named = (items: { name: string; id: string }[]) =>
    Object.fromEntries(items.map((item) => [item.name, item.id]));

  return {
    /** A fresh id that nothing has. */
    id,

    /** Adds attendees; returns their ids, in order. */
    attendees<const Names extends string[]>(...names: Names): { [K in keyof Names]: string } {
      return names.map((name) => {
        const attendee = { id: id(), name, ...meta };
        attendees.push(attendee);
        return attendee.id;
      }) as { [K in keyof Names]: string };
    },

    /** Adds an ingredient to the catalogue; returns its id. */
    ingredient(
      name: string,
      unit: string,
      shopSection: ShopSection = 'pantry',
      overrides: Partial<Ingredient> = {}
    ): string {
      const ingredient = {
        id: id(),
        name,
        unit,
        shopSection,
        deleted: false,
        ...meta,
        ...overrides
      };
      ingredients.push(ingredient);
      return ingredient.id;
    },

    /** Adds a recipe to the catalogue from `[ingredientId, quantity]` lines; returns its id. */
    recipe(
      name: string,
      servings: number,
      lines: [ingredientId: string, quantity: number][],
      overrides: Partial<Recipe> = {}
    ): string {
      const recipe = {
        id: id(),
        name,
        servings,
        lines: lines.map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
        notes: '',
        deleted: false,
        ...meta,
        ...overrides
      };
      recipes.push(recipe);
      return recipe.id;
    },

    /** Adds a meal with its mealtimes sorted by `at`; returns it (mutable, for tweaks). */
    meal(options: MealOptions): Meal {
      const ats = [...(options.ats ?? (options.at ? [options.at] : []))].sort();
      if (ats.length === 0) throw new Error('meal needs `at` or `ats`');
      const mealId = id();
      const meal: Meal = {
        id: mealId,
        name: options.name ?? `${ats[0]} ${options.slot}`,
        slot: options.slot,
        recipeId: options.recipe ?? null,
        mealtimes: ats.map((at) => ({ id: id(), at, attendeeIds: [...(options.eaters ?? [])] })),
        ...meta
      };
      meals.push(meal);
      return meal;
    },

    build(): {
      facts: HolidayFacts;
      catalogue: Catalogue;
      ids: Record<'attendees' | 'meals' | 'recipes' | 'ingredients', Record<string, string>>;
    } {
      return {
        facts: { holiday, attendees, meals, trips: [], stockChanges: [] },
        catalogue: { recipes, ingredients },
        ids: {
          attendees: named(attendees),
          meals: named(meals),
          recipes: named(recipes),
          ingredients: named(ingredients)
        }
      };
    }
  };
}
