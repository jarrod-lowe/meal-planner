// Runs in the components project, where `$derived` is reactive.
import { describe, expect, it } from 'vitest';
import type { Schemas } from '#lib/api/client.js';
import { ingredient, loadedCatalogue, recipe, stored } from '#lib/test/catalogue.js';
import { facts, loadedHoliday, meta } from '#lib/test/holiday.js';
import { engineFacts, PlanStore } from './plan.svelte.js';

const ann = { id: '0190a0b0-0000-7000-8000-0000000000a1', name: 'Ann', version: 1, ...meta };
const bob = { id: '0190a0b0-0000-7000-8000-0000000000a2', name: 'Bob', version: 1, ...meta };
const mince = ingredient('Mince', 'g');
const bolognese = recipe('Bolognese', {
  servings: 4,
  lines: [{ ingredientId: mince.id, quantity: 500 }]
});

const dinner = (attendeeIds: string[], version = 1): Schemas['Meal'] => ({
  id: '0190a0b0-0000-7000-8000-0000000000c1',
  name: '1 Jan Dinner',
  slot: 'dinner',
  recipeId: bolognese.id,
  mealtimes: [{ id: '0190a0b0-0000-7000-8000-0000000000d1', at: '2027-01-01T18:30', attendeeIds }],
  version,
  ...meta
});

async function setup(initial = facts({ attendees: [ann, bob], meals: [dinner([ann.id])] })) {
  const holiday = await loadedHoliday(initial);
  const catalogue = await loadedCatalogue({ recipes: [bolognese], ingredients: [mince] });
  const clock = $state<{ now: string | null }>({ now: '2026-12-26T09:00' });
  const store = new PlanStore({
    holiday: holiday.store,
    catalogue: catalogue.store,
    now: {
      get current() {
        return clock.now;
      }
    }
  });
  return { holiday, catalogue, clock, store };
}

const mealFields = ({ name, slot, recipeId, mealtimes }: Schemas['Meal']) => ({
  name,
  slot,
  recipeId,
  mealtimes
});

const minceFor = (store: PlanStore) =>
  store.plan?.consumption.get('0190a0b0-0000-7000-8000-0000000000d1');

describe('PlanStore', () => {
  it('works out the plan from the holiday, the catalogue and now', async () => {
    const { store } = await setup();

    expect(minceFor(store)).toEqual([{ ingredientId: mince.id, quantity: 125 }]);
    expect(store.plan?.warnings).toEqual([]);
  });

  it('re-derives when the facts change', async () => {
    const { store, holiday } = await setup();
    expect(minceFor(store)?.[0]?.quantity).toBe(125);

    holiday.reply('PUT', stored);
    const saving = holiday.store.mutate({
      kind: 'meals',
      id: dinner([]).id,
      fields: mealFields(dinner([ann.id, bob.id]))
    });

    // Optimistic: the plan moves before the write lands.
    expect(minceFor(store)?.[0]?.quantity).toBe(250);
    await saving;
    expect(minceFor(store)?.[0]?.quantity).toBe(250);
  });

  it('re-derives when now passes a meal without a recipe', async () => {
    const meal = { ...dinner([ann.id]), recipeId: null };
    const { store, clock } = await setup(facts({ attendees: [ann], meals: [meal] }));
    expect(store.plan?.warnings.map((w) => w.code)).toEqual(['meal-without-recipe']);

    clock.now = '2027-01-01T18:31';
    expect(store.plan?.warnings).toEqual([]);
  });

  it('is null until the holiday, the catalogue and now are all there', async () => {
    const { store, clock, holiday } = await setup();

    clock.now = null;
    expect(store.plan).toBeNull();
    clock.now = '2026-12-26T09:00';
    expect(store.plan).not.toBeNull();
    holiday.store.clear();
    expect(store.plan).toBeNull();
  });
});

describe('engineFacts', () => {
  it('keeps the holiday, attendees and meals, and drops the members', () => {
    const input = facts({ attendees: [ann], meals: [dinner([ann.id])], members: [] });

    expect(engineFacts(input)).toEqual({
      holiday: input.holiday,
      attendees: [ann],
      meals: [dinner([ann.id])],
      trips: [],
      stockChanges: []
    });
  });
});
