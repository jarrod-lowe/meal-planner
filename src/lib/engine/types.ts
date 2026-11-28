// The engine's inputs and outputs (DESIGN §3). Stored facts come from the
// generated API types; trips and stock changes are written here until the API
// types them (phases 6 and 7).
import type { components } from '#lib/api/types.js';
import type { ShopSection } from '#lib/model/sections.js';

type Schemas = components['schemas'];

export type LocalDateTime = Schemas['LocalDateTime'];
export type Holiday = Schemas['Holiday'];
export type Attendee = Schemas['Attendee'];
export type Meal = Schemas['Meal'];
export type Mealtime = Schemas['Mealtime'];
export type Recipe = Schemas['Recipe'];
export type RecipeLine = Schemas['RecipeLine'];
export type Ingredient = Schemas['Ingredient'];

type Versioned = Pick<Holiday, 'version' | 'updatedAt' | 'updatedBy'>;

export interface ShoppingTrip extends Versioned {
  id: string;
  name: string;
  at: LocalDateTime;
  sections: ShopSection[];
  status: 'planned' | 'done';
}

export interface ManualStockChange extends Versioned {
  id: string;
  kind: 'add' | 'remove';
  at: LocalDateTime;
  ingredientId: string;
  quantity: number;
  note?: string;
}

/** Happens at its trip's `at`; it has no time of its own. */
export interface Purchase extends Versioned {
  id: string;
  kind: 'purchase';
  tripId: string;
  ingredientId: string;
  quantity: number;
}

export type StockChange = ManualStockChange | Purchase;

export interface HolidayFacts {
  holiday: Holiday;
  attendees: Attendee[];
  meals: Meal[];
  trips: ShoppingTrip[];
  stockChanges: StockChange[];
}

export interface Catalogue {
  recipes: Recipe[];
  ingredients: Ingredient[];
}

/** Scaled to the mealtime's servings. */
export interface ConsumptionLine {
  ingredientId: string;
  quantity: number;
}

export interface ShoppingListLine {
  ingredientId: string;
  /** What the plan says to buy (0 if only recorded, not listed). */
  listQuantity: number;
  /** Sum of purchases recorded against this trip. */
  recordedQuantity: number;
}

export interface Shortfall {
  mealtimeId: string;
  mealId: string;
  ingredientId: string;
  at: LocalDateTime;
  needed: number;
  available: number;
  missing: number;
  /** `at` < now */
  past: boolean;
}

export type StockSource =
  | { type: 'manual'; stockChangeId: string }
  /** `assumed`: a planned trip. */
  | { type: 'trip'; tripId: string; assumed: boolean }
  | { type: 'mealtime'; mealtimeId: string; mealId: string };

export interface StockEntry {
  at: LocalDateTime;
  source: StockSource;
  /** Signed; what actually moved. */
  delta: number;
  /** After this entry; never negative. */
  balance: number;
}

/** DESIGN §3.6, in the order `plan()` sorts them. */
export type Warning =
  /** Only if one of the meal's mealtimes is at or after now. */
  | { code: 'meal-without-recipe'; mealId: string }
  | { code: 'mealtime-without-attendees'; mealId: string; mealtimeId: string }
  | { code: 'missing-recipe'; mealId: string; recipeId: string }
  | { code: 'missing-ingredient'; ingredientId: string; recipeId?: string; stockChangeId?: string }
  | { code: 'removed-more-than-stock'; stockChangeId: string; ingredientId: string; excess: number }
  /** Planned and at < now. */
  | { code: 'trip-not-finished'; tripId: string }
  | { code: 'outside-holiday-dates'; mealId?: string; tripId?: string; stockChangeId?: string };

export type WarningCode = Warning['code'];

export interface Plan {
  /** By mealtime id. Only mealtimes that consume: a resolvable recipe and servings > 0. */
  consumption: Map<string, ConsumptionLine[]>;
  /** By trip id. */
  shoppingLists: Map<string, ShoppingListLine[]>;
  /** Sorted by time, then ingredient name. */
  shortfalls: Shortfall[];
  /** By ingredient id: its full timeline. */
  stock: Map<string, StockEntry[]>;
  warnings: Warning[];
}
