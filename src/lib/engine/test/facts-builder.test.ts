import { describe, expect, it } from 'vitest';
import { factsBuilder } from './facts-builder.js';

describe('factsBuilder', () => {
  it('builds an empty holiday with default dates and time zone', () => {
    const { facts, catalogue } = factsBuilder().build();
    expect(facts.holiday).toMatchObject({
      startDate: '2027-01-01',
      endDate: '2027-01-07',
      timeZone: 'Pacific/Auckland',
      version: 1
    });
    expect(facts).toMatchObject({ attendees: [], meals: [], trips: [], stockChanges: [] });
    expect(catalogue).toEqual({ recipes: [], ingredients: [] });
  });

  it('takes the holiday dates and time zone', () => {
    const { facts } = factsBuilder({
      startDate: '2027-03-01',
      endDate: '2027-03-03',
      timeZone: 'Europe/London'
    }).build();
    expect(facts.holiday).toMatchObject({
      startDate: '2027-03-01',
      endDate: '2027-03-03',
      timeZone: 'Europe/London'
    });
  });

  it('adds attendees and returns their ids, in order', () => {
    const b = factsBuilder();
    const [ann, bob] = b.attendees('Ann', 'Bob');
    const { facts, ids } = b.build();
    expect(facts.attendees.map((a) => [a.id, a.name])).toEqual([
      [ann, 'Ann'],
      [bob, 'Bob']
    ]);
    expect(ids.attendees).toEqual({ Ann: ann, Bob: bob });
  });

  it('adds ingredients and recipes to the catalogue', () => {
    const b = factsBuilder();
    const mince = b.ingredient('Mince', 'g', 'meat-fish');
    const pasta = b.ingredient('Pasta', 'g');
    const old = b.ingredient('Old salt', 'g', 'pantry', { deleted: true });
    const bolognese = b.recipe('Bolognese', 4, [
      [mince, 500],
      [pasta, 400]
    ]);
    const gone = b.recipe('Gone', 2, [], { deleted: true });
    const { catalogue, ids } = b.build();

    expect(catalogue.ingredients).toEqual([
      expect.objectContaining({ id: mince, name: 'Mince', unit: 'g', shopSection: 'meat-fish' }),
      expect.objectContaining({ id: pasta, name: 'Pasta', shopSection: 'pantry', deleted: false }),
      expect.objectContaining({ id: old, deleted: true })
    ]);
    expect(catalogue.recipes).toEqual([
      expect.objectContaining({
        id: bolognese,
        name: 'Bolognese',
        servings: 4,
        lines: [
          { ingredientId: mince, quantity: 500 },
          { ingredientId: pasta, quantity: 400 }
        ],
        deleted: false
      }),
      expect.objectContaining({ id: gone, deleted: true })
    ]);
    expect(ids.ingredients).toEqual({ Mince: mince, Pasta: pasta, 'Old salt': old });
    expect(ids.recipes).toEqual({ Bolognese: bolognese, Gone: gone });
  });

  it('adds a one-off meal with one mealtime', () => {
    const b = factsBuilder();
    const [ann, bob] = b.attendees('Ann', 'Bob');
    const recipe = b.recipe('Soup', 2, []);
    const meal = b.meal({ slot: 'dinner', at: '2027-01-01T18:30', recipe, eaters: [ann, bob] });
    const { facts, ids } = b.build();

    expect(facts.meals).toEqual([meal]);
    expect(meal).toMatchObject({
      name: '2027-01-01T18:30 dinner',
      slot: 'dinner',
      recipeId: recipe,
      mealtimes: [{ id: meal.mealtimes[0]?.id, at: '2027-01-01T18:30', attendeeIds: [ann, bob] }]
    });
    expect(ids.meals).toEqual({ [meal.name]: meal.id });
  });

  it('adds a meal with several mealtimes, sorted by at, and defaults', () => {
    const b = factsBuilder();
    const meal = b.meal({
      name: 'Lunches',
      slot: 'lunch',
      ats: ['2027-01-03T12:30', '2027-01-02T12:30']
    });
    expect(meal.recipeId).toBeNull();
    expect(meal.mealtimes.map((m) => [m.at, m.attendeeIds])).toEqual([
      ['2027-01-02T12:30', []],
      ['2027-01-03T12:30', []]
    ]);
    expect(new Set(meal.mealtimes.map((m) => m.id)).size).toBe(2);
  });

  it('mints fresh ids for dangling references', () => {
    const b = factsBuilder();
    const [ann] = b.attendees('Ann');
    expect(b.id()).not.toBe(ann);
  });

  it('gives the same ids for the same steps', () => {
    const make = () => {
      const b = factsBuilder();
      b.attendees('Ann');
      b.ingredient('Mince', 'g');
      b.meal({ slot: 'dinner', at: '2027-01-01T18:30' });
      return b.build();
    };
    expect(make()).toEqual(make());
  });

  it('gives every item a distinct UUID-shaped id', () => {
    const b = factsBuilder();
    const all = [...b.attendees('A', 'B'), b.ingredient('I', 'g'), b.recipe('R', 1, []), b.id()];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-\d{12}$/);
  });
});
