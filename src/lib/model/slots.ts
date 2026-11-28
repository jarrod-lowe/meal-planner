import type { components } from '#lib/api/types.js';

export type MealSlot = components['schemas']['MealSlot'];

/** Meal slots in the order of the planner grid's columns (DESIGN §2.1). */
export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'dinner',
  'snacks',
  'other'
] as const satisfies readonly MealSlot[];

// Fails to compile if the openapi enum gains a slot missing from the list.
type Missing = Exclude<MealSlot, (typeof MEAL_SLOTS)[number]>;
const allSlotsListed: [Missing] extends [never] ? true : Missing = true;
void allSlotsListed;

/** Each slot's default `HH:mm` for a new mealtime. UI defaults only (DESIGN §2.1). */
export const SLOT_DEFAULT_TIMES: Readonly<Record<MealSlot, string>> = {
  breakfast: '08:00',
  lunch: '12:30',
  dinner: '18:30',
  snacks: '15:00',
  other: '12:00'
};
