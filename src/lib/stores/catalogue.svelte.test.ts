// Runs in the components project: the browser build compiles `$state` class
// fields to accessors, unlike the node build `catalogue.test.ts` runs under.
import { describe, expect, it } from 'vitest';
import { ingredient, loadedCatalogue, recipe, stored } from '#lib/test/catalogue.js';

describe('CatalogueStore in the browser build', () => {
  it('leaves the other kind’s list alone when writing, hiding and showing', async () => {
    const flour = ingredient('Flour', 'g');
    const pancakes = recipe('Pancakes');
    const { store, reply } = await loadedCatalogue({ recipes: [pancakes], ingredients: [flour] });
    reply('PUT', stored, stored);

    await store.mutate({
      kind: 'ingredients',
      id: '0190a0b0-0000-7000-8000-0000000000e1',
      fields: { name: 'Eggs', unit: 'each', shopSection: 'dairy', deleted: false }
    });
    expect(store.recipes).toEqual([pancakes]);

    await store.mutate({
      kind: 'recipes',
      id: pancakes.id,
      fields: { name: 'Crepes', servings: 2, lines: [], notes: '', deleted: false }
    });
    expect(store.ingredients.map((item) => item.name)).toEqual(['Flour', 'Eggs']);
  });
});
