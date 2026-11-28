import { describe, expect, it } from 'vitest';
import { EPSILON, plan } from './index.js';
import { factsBuilder } from './test/facts-builder.js';

const NOW = '2027-01-01T00:00';
const AT = '2027-01-01T18:30';

/** A holiday with `eaters` people and a recipe of 500 g mince and 400 g pasta for `servings`. */
function dinnerFor(eaters: number, servings: number) {
  const b = factsBuilder();
  const people = b.attendees(...Array.from({ length: eaters }, (_, i) => `P${i}`));
  const mince = b.ingredient('Mince', 'g', 'meat-fish');
  const pasta = b.ingredient('Pasta', 'g');
  const recipe = b.recipe('Bolognese', servings, [
    [mince, 500],
    [pasta, 400]
  ]);
  const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: people });
  return { b, mince, pasta, recipe, meal, mealtimeId: meal.mealtimes[0]!.id };
}

describe('plan: consumption', () => {
  it('returns the full Plan shape, with lists, shortfalls and stock empty', () => {
    const { facts, catalogue } = factsBuilder().build();
    const result = plan(facts, catalogue, NOW);
    expect(result.consumption).toEqual(new Map());
    expect(result.shoppingLists).toEqual(new Map());
    expect(result.shortfalls).toEqual([]);
    expect(result.stock).toEqual(new Map());
    expect(result.warnings).toEqual([]);
  });

  it('doubles every quantity when a recipe for 4 is eaten by 8', () => {
    const { b, mince, pasta, mealtimeId } = dinnerFor(8, 4);
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(mealtimeId)).toEqual([
      { ingredientId: mince, quantity: 1000 },
      { ingredientId: pasta, quantity: 800 }
    ]);
  });

  it('keeps fractional quantities exactly when a recipe for 3 is eaten by 2', () => {
    const { b, mince, pasta, mealtimeId } = dinnerFor(2, 3);
    const { facts, catalogue } = b.build();
    const lines = plan(facts, catalogue, NOW).consumption.get(mealtimeId) ?? [];
    expect(lines.map((l) => l.ingredientId)).toEqual([mince, pasta]);
    expect(Math.abs(lines[0]!.quantity - 1000 / 3)).toBeLessThan(EPSILON);
    expect(Math.abs(lines[1]!.quantity - 800 / 3)).toBeLessThan(EPSILON);
    // Not rounded to display precision.
    expect(lines[0]!.quantity).not.toBe(333.33);
  });

  it('consumes nothing when no one is eating', () => {
    const { b, mealtimeId } = dinnerFor(0, 4);
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.has(mealtimeId)).toBe(false);
  });

  it("doesn't count a deleted attendee", () => {
    const b = factsBuilder();
    const [ann] = b.attendees('Ann');
    const mince = b.ingredient('Mince', 'g');
    const recipe = b.recipe('Bolognese', 4, [[mince, 400]]);
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: [ann, b.id()] });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: mince, quantity: 100 }
    ]);
  });

  it('counts a repeated attendee id once', () => {
    const b = factsBuilder();
    const [ann] = b.attendees('Ann');
    const mince = b.ingredient('Mince', 'g');
    const recipe = b.recipe('Bolognese', 4, [[mince, 400]]);
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: [ann, ann] });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: mince, quantity: 100 }
    ]);
  });

  it('uses a soft-deleted recipe and ingredient normally', () => {
    const b = factsBuilder();
    const people = b.attendees('Ann', 'Bob');
    const mince = b.ingredient('Mince', 'g', 'meat-fish', { deleted: true });
    const recipe = b.recipe('Bolognese', 2, [[mince, 300]], { deleted: true });
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: people });
    const { facts, catalogue } = b.build();
    const result = plan(facts, catalogue, NOW);
    expect(result.consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: mince, quantity: 300 }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('gives no consumption for a missing recipe', () => {
    const b = factsBuilder();
    const people = b.attendees('Ann');
    const meal = b.meal({ slot: 'dinner', at: AT, recipe: b.id(), eaters: people });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.has(meal.mealtimes[0]!.id)).toBe(false);
  });

  it('gives no consumption for a meal without a recipe', () => {
    const b = factsBuilder();
    const people = b.attendees('Ann');
    const meal = b.meal({ slot: 'dinner', at: AT, eaters: people });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.has(meal.mealtimes[0]!.id)).toBe(false);
  });

  it("skips a missing ingredient's line", () => {
    const b = factsBuilder();
    const people = b.attendees('Ann', 'Bob');
    const pasta = b.ingredient('Pasta', 'g');
    const recipe = b.recipe('Bolognese', 2, [
      [b.id(), 500],
      [pasta, 400]
    ]);
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: people });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: pasta, quantity: 400 }
    ]);
  });

  it('keeps an empty entry for a recipe whose lines all resolve to nothing', () => {
    const b = factsBuilder();
    const people = b.attendees('Ann');
    const recipe = b.recipe('Water', 1, []);
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: people });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(meal.mealtimes[0]!.id)).toEqual([]);
  });

  it('sums an ingredient that appears in two lines', () => {
    const b = factsBuilder();
    const people = b.attendees('Ann', 'Bob');
    const mince = b.ingredient('Mince', 'g');
    const recipe = b.recipe('Bolognese', 2, [
      [mince, 300],
      [mince, 200]
    ]);
    const meal = b.meal({ slot: 'dinner', at: AT, recipe, eaters: people });
    const { facts, catalogue } = b.build();
    expect(plan(facts, catalogue, NOW).consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: mince, quantity: 500 }
    ]);
  });

  it('consumes for each mealtime of a meal, by its own eaters', () => {
    const b = factsBuilder();
    const [ann, bob] = b.attendees('Ann', 'Bob');
    const mince = b.ingredient('Mince', 'g');
    const recipe = b.recipe('Bolognese', 1, [[mince, 100]]);
    const meal = b.meal({
      slot: 'dinner',
      ats: ['2027-01-01T18:30', '2027-01-02T18:30'],
      recipe,
      eaters: [ann]
    });
    meal.mealtimes[1]!.attendeeIds.push(bob);
    const { facts, catalogue } = b.build();
    const { consumption } = plan(facts, catalogue, NOW);
    expect(consumption.get(meal.mealtimes[0]!.id)).toEqual([
      { ingredientId: mince, quantity: 100 }
    ]);
    expect(consumption.get(meal.mealtimes[1]!.id)).toEqual([
      { ingredientId: mince, quantity: 200 }
    ]);
  });

  it('has Dinner A and Dinner B both consume', () => {
    const b = factsBuilder();
    const [ann, bob, cat] = b.attendees('Ann', 'Bob', 'Cat');
    const mince = b.ingredient('Mince', 'g');
    const tofu = b.ingredient('Tofu', 'g');
    const bolognese = b.recipe('Bolognese', 1, [[mince, 100]]);
    const stirFry = b.recipe('Stir fry', 1, [[tofu, 150]]);
    const a = b.meal({
      name: 'Dinner A',
      slot: 'dinner',
      at: AT,
      recipe: bolognese,
      eaters: [ann, bob]
    });
    const bMeal = b.meal({
      name: 'Dinner B',
      slot: 'dinner',
      at: AT,
      recipe: stirFry,
      eaters: [cat]
    });
    const { facts, catalogue } = b.build();
    const { consumption } = plan(facts, catalogue, NOW);
    expect(consumption.get(a.mealtimes[0]!.id)).toEqual([{ ingredientId: mince, quantity: 200 }]);
    expect(consumption.get(bMeal.mealtimes[0]!.id)).toEqual([
      { ingredientId: tofu, quantity: 150 }
    ]);
  });

  it("doesn't change the facts or catalogue", () => {
    const { b } = dinnerFor(8, 4);
    const { facts, catalogue } = b.build();
    const before: unknown = JSON.parse(JSON.stringify({ facts, catalogue }));
    plan(facts, catalogue, NOW);
    expect({ facts, catalogue }).toEqual(before);
  });
});
