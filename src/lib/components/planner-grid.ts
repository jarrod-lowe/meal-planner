// The planner grid's layout (DESIGN §7.4): a row per day of the holiday, a
// cell per meal slot, and a chip per mealtime in its date's row and its
// meal's slot.
import type { Schemas } from '#lib/api/client.js';
import { datesFrom } from '#lib/model/dates.js';
import { servings } from '#lib/model/meals.js';
import { MEAL_SLOTS, type MealSlot } from '#lib/model/slots.js';

type Meal = Schemas['Meal'];
type Mealtime = Schemas['Mealtime'];

export interface Chip {
  readonly meal: Meal;
  readonly mealtime: Mealtime;
  readonly servings: number;
}

export interface PlannerDay {
  /** A `LocalDate`. */
  readonly date: string;
  /** Per slot, in `MEAL_SLOTS` order; parallel meals sorted by time, then meal id. */
  readonly cells: Readonly<Record<MealSlot, readonly Chip[]>>;
}

export interface PlannerGrid {
  readonly days: readonly PlannerDay[];
  /** Meals with a mealtime outside the holiday's dates, in the facts' order. */
  readonly outside: readonly Meal[];
}

type Facts = Pick<Schemas['HolidayFacts'], 'holiday' | 'attendees' | 'meals'>;

const byTimeThenId = (a: Chip, b: Chip) =>
  a.mealtime.at.localeCompare(b.mealtime.at) ||
  a.meal.id.localeCompare(b.meal.id) ||
  a.mealtime.id.localeCompare(b.mealtime.id);

export function plannerGrid({ holiday, attendees, meals }: Facts): PlannerGrid {
  const cells = new Map<string, Chip[]>();
  const days = datesFrom(holiday.startDate, holiday.endDate).map((date) => {
    const row = Object.fromEntries(MEAL_SLOTS.map((slot) => [slot, [] as Chip[]]));
    for (const slot of MEAL_SLOTS) cells.set(`${date} ${slot}`, row[slot] ?? []);
    return { date, cells: row as Record<MealSlot, Chip[]> };
  });

  const outside: Meal[] = [];
  for (const meal of meals) {
    let isOutside = false;
    for (const mealtime of meal.mealtimes) {
      const cell = cells.get(`${mealtime.at.slice(0, 10)} ${meal.slot}`);
      if (cell) cell.push({ meal, mealtime, servings: servings(mealtime, attendees) });
      else isOutside = true;
    }
    if (isOutside) outside.push(meal);
  }
  for (const cell of cells.values()) cell.sort(byTimeThenId);
  return { days, outside };
}
