import { describe, expect, it } from 'vitest';
import { plan, type Warning } from './index.js';
import { factsBuilder } from './test/facts-builder.js';

const NOW = '2027-01-03T12:00';

const warningsOf = (b: ReturnType<typeof factsBuilder>, now = NOW): Warning[] => {
  const { facts, catalogue } = b.build();
  return plan(facts, catalogue, now).warnings;
};

describe('plan: warnings', () => {
  describe('meal-without-recipe', () => {
    it('warns about an upcoming meal with no recipe', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const meal = b.meal({ slot: 'dinner', at: '2027-01-03T18:30', eaters: people });
      expect(warningsOf(b)).toEqual([{ code: 'meal-without-recipe', mealId: meal.id }]);
    });

    it('warns when a mealtime is exactly now', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const meal = b.meal({ slot: 'lunch', at: NOW, eaters: people });
      expect(warningsOf(b)).toEqual([{ code: 'meal-without-recipe', mealId: meal.id }]);
    });

    it("doesn't warn when every mealtime is before now", () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      b.meal({ slot: 'dinner', ats: ['2027-01-01T18:30', '2027-01-03T11:59'], eaters: people });
      expect(warningsOf(b)).toEqual([]);
    });

    it('warns once when some mealtimes are past and some upcoming', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const meal = b.meal({
        slot: 'dinner',
        ats: ['2027-01-01T18:30', '2027-01-03T18:30', '2027-01-04T18:30'],
        eaters: people
      });
      expect(warningsOf(b)).toEqual([{ code: 'meal-without-recipe', mealId: meal.id }]);
    });
  });

  describe('mealtime-without-attendees', () => {
    it('warns about each mealtime no one is eating', () => {
      const b = factsBuilder();
      const [ann] = b.attendees('Ann');
      const recipe = b.recipe('Soup', 2, []);
      const meal = b.meal({
        slot: 'lunch',
        ats: ['2027-01-04T12:30', '2027-01-05T12:30', '2027-01-06T12:30'],
        recipe
      });
      meal.mealtimes[1]!.attendeeIds.push(ann);
      expect(warningsOf(b)).toEqual([
        { code: 'mealtime-without-attendees', mealId: meal.id, mealtimeId: meal.mealtimes[0]!.id },
        { code: 'mealtime-without-attendees', mealId: meal.id, mealtimeId: meal.mealtimes[2]!.id }
      ]);
    });

    it('warns when every attendee has been deleted', () => {
      const b = factsBuilder();
      const recipe = b.recipe('Soup', 2, []);
      const meal = b.meal({ slot: 'lunch', at: '2027-01-04T12:30', recipe, eaters: [b.id()] });
      expect(warningsOf(b)).toEqual([
        { code: 'mealtime-without-attendees', mealId: meal.id, mealtimeId: meal.mealtimes[0]!.id }
      ]);
    });

    it('warns about past mealtimes too', () => {
      const b = factsBuilder();
      const recipe = b.recipe('Soup', 2, []);
      const meal = b.meal({ slot: 'lunch', at: '2027-01-01T12:30', recipe });
      expect(warningsOf(b)).toEqual([
        { code: 'mealtime-without-attendees', mealId: meal.id, mealtimeId: meal.mealtimes[0]!.id }
      ]);
    });
  });

  describe('dangling references', () => {
    it('warns about a missing recipe, and nothing else', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const recipeId = b.id();
      const meal = b.meal({
        slot: 'dinner',
        ats: ['2027-01-04T18:30', '2027-01-05T18:30'],
        recipe: recipeId,
        eaters: people
      });
      expect(warningsOf(b)).toEqual([{ code: 'missing-recipe', mealId: meal.id, recipeId }]);
    });

    it('warns about a missing recipe for past meals too', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const recipeId = b.id();
      const meal = b.meal({
        slot: 'dinner',
        at: '2027-01-01T18:30',
        recipe: recipeId,
        eaters: people
      });
      expect(warningsOf(b)).toEqual([{ code: 'missing-recipe', mealId: meal.id, recipeId }]);
    });

    it('warns once per recipe and missing ingredient, however many meals use it', () => {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const gone = b.id();
      const pasta = b.ingredient('Pasta', 'g');
      const recipe = b.recipe('Bolognese', 2, [
        [gone, 500],
        [pasta, 400]
      ]);
      b.meal({ slot: 'dinner', at: '2027-01-04T18:30', recipe, eaters: people });
      b.meal({ slot: 'dinner', at: '2027-01-05T18:30', recipe, eaters: people });
      expect(warningsOf(b)).toEqual([
        { code: 'missing-ingredient', ingredientId: gone, recipeId: recipe }
      ]);
    });

    it("doesn't warn about a recipe no meal uses", () => {
      const b = factsBuilder();
      b.recipe('Unused', 2, [[b.id(), 500]]);
      expect(warningsOf(b)).toEqual([]);
    });

    it('warns about a used recipe even when no one is eating it', () => {
      const b = factsBuilder();
      const gone = b.id();
      const recipe = b.recipe('Bolognese', 2, [[gone, 500]]);
      const meal = b.meal({ slot: 'dinner', at: '2027-01-04T18:30', recipe });
      expect(warningsOf(b)).toEqual([
        { code: 'mealtime-without-attendees', mealId: meal.id, mealtimeId: meal.mealtimes[0]!.id },
        { code: 'missing-ingredient', ingredientId: gone, recipeId: recipe }
      ]);
    });

    it('ignores a deleted attendee when others remain', () => {
      const b = factsBuilder();
      const [ann] = b.attendees('Ann');
      const recipe = b.recipe('Soup', 2, []);
      b.meal({ slot: 'dinner', at: '2027-01-04T18:30', recipe, eaters: [ann, b.id()] });
      expect(warningsOf(b)).toEqual([]);
    });
  });

  describe('order', () => {
    // Ids are minted in call order, so they sort in call order.
    function messyHoliday() {
      const b = factsBuilder();
      const people = b.attendees('Ann');
      const goneA = b.id();
      const goneB = b.id();
      const missingRecipe = b.id();
      const r1 = b.recipe('R1', 1, [
        [goneB, 1],
        [goneA, 1]
      ]);
      const r2 = b.recipe('R2', 1, [[goneA, 1]]);
      const m1 = b.meal({ slot: 'dinner', at: '2027-01-04T18:30' });
      const m2 = b.meal({ slot: 'lunch', at: '2027-01-04T12:30', recipe: r2 });
      const m3 = b.meal({
        slot: 'dinner',
        at: '2027-01-05T18:30',
        recipe: missingRecipe,
        eaters: people
      });
      b.meal({ slot: 'dinner', at: '2027-01-06T18:30', recipe: r1, eaters: people });
      const { facts, catalogue } = b.build();
      return { facts, catalogue, goneA, goneB, missingRecipe, r1, r2, m1, m2, m3 };
    }

    it('sorts by warning code, then by ids', () => {
      const h = messyHoliday();
      expect(plan(h.facts, h.catalogue, NOW).warnings).toEqual([
        { code: 'meal-without-recipe', mealId: h.m1.id },
        { code: 'mealtime-without-attendees', mealId: h.m1.id, mealtimeId: h.m1.mealtimes[0]!.id },
        { code: 'mealtime-without-attendees', mealId: h.m2.id, mealtimeId: h.m2.mealtimes[0]!.id },
        { code: 'missing-recipe', mealId: h.m3.id, recipeId: h.missingRecipe },
        { code: 'missing-ingredient', ingredientId: h.goneA, recipeId: h.r1 },
        { code: 'missing-ingredient', ingredientId: h.goneB, recipeId: h.r1 },
        { code: 'missing-ingredient', ingredientId: h.goneA, recipeId: h.r2 }
      ]);
    });

    it("doesn't depend on the order of the facts", () => {
      const forward = messyHoliday();
      const backward = messyHoliday();
      backward.facts.meals.reverse();
      backward.facts.attendees.reverse();
      backward.catalogue.recipes.reverse();
      backward.catalogue.recipes.forEach((r) => r.lines.reverse());
      expect(plan(backward.facts, backward.catalogue, NOW).warnings).toEqual(
        plan(forward.facts, forward.catalogue, NOW).warnings
      );
    });
  });
});
