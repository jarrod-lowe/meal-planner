import { describe, expect, it } from 'vitest';
import type { Schemas } from '#lib/api/client.js';
import { facts, meta } from '#lib/test/holiday.js';
import { plannerGrid } from './planner-grid.js';

const ann = { id: '0190a0b0-0000-7000-8000-0000000000a1', name: 'Ann', version: 1, ...meta };

let next = 0;
function meal(
  slot: Schemas['MealSlot'],
  ats: string[],
  overrides: Partial<Schemas['Meal']> = {}
): Schemas['Meal'] {
  next++;
  return {
    id: `0190a0b0-0000-7000-8000-0000000c${String(next).padStart(4, '0')}`,
    name: `Meal ${next}`,
    slot,
    recipeId: null,
    mealtimes: ats.map((at, n) => ({
      id: `0190a0b0-0000-7000-8000-000000${String(next).padStart(4, '0')}d${n}`.padEnd(36, '0'),
      at,
      attendeeIds: [ann.id]
    })),
    version: 1,
    ...meta,
    ...overrides
  };
}

const holiday = (meals: Schemas['Meal'][]) =>
  facts({
    holiday: { ...facts().holiday, startDate: '2026-12-31', endDate: '2027-01-02' },
    attendees: [ann],
    meals
  });

describe('plannerGrid', () => {
  it('has a row per day, start to end, and a cell per slot', () => {
    const grid = plannerGrid(holiday([]));

    expect(grid.days.map((day) => day.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
    expect(Object.keys(grid.days[0]?.cells ?? {})).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'snacks',
      'other'
    ]);
    expect(grid.outside).toEqual([]);
  });

  it('puts each mealtime in its date’s row and its meal’s slot, with its servings', () => {
    const dinner = meal('dinner', ['2027-01-01T18:30']);
    // A late snack is still in the snacks column, whatever its time.
    const snack = meal('snacks', ['2027-01-01T23:00']);
    const grid = plannerGrid(holiday([dinner, snack]));

    const day = grid.days[1];
    expect(day?.cells.dinner.map((chip) => [chip.meal.id, chip.servings])).toEqual([
      [dinner.id, 1]
    ]);
    expect(day?.cells.snacks.map((chip) => chip.meal.id)).toEqual([snack.id]);
    expect(day?.cells.lunch).toEqual([]);
  });

  it('sorts parallel meals in a cell by time, then id', () => {
    const later = meal('dinner', ['2027-01-01T19:00']);
    const b = meal('dinner', ['2027-01-01T18:30']);
    const a = meal('dinner', ['2027-01-01T18:30'], { id: '0190a0b0-0000-7000-8000-000000000000' });
    const grid = plannerGrid(holiday([later, b, a]));

    expect(grid.days[1]?.cells.dinner.map((chip) => chip.meal.id)).toEqual([a.id, b.id, later.id]);
  });

  it('lists meals with mealtimes outside the holiday dates, once each', () => {
    const early = meal('lunch', ['2026-12-30T12:30', '2026-12-29T12:30']);
    const split = meal('lunch', ['2027-01-02T12:30', '2027-01-03T12:30']);
    const grid = plannerGrid(holiday([early, split]));

    expect(grid.outside.map((m) => m.id)).toEqual([early.id, split.id]);
    // The mealtime inside the dates is still on the grid.
    expect(grid.days[2]?.cells.lunch.map((chip) => chip.meal.id)).toEqual([split.id]);
  });
});
