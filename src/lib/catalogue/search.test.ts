import { describe, expect, it } from 'vitest';
import type { components } from '#lib/api/types.js';
import {
  COMMON_UNITS,
  isDuplicate,
  searchIngredients,
  searchRecipes,
  suggestIngredients,
  unitSuggestions,
  type CommonIngredient
} from './search.js';

type Ingredient = components['schemas']['Ingredient'];
type Recipe = components['schemas']['Recipe'];

let nextId = 0;

function ingredient(name: string, unit: string, extra: Partial<Ingredient> = {}): Ingredient {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    name,
    unit,
    shopSection: 'pantry',
    deleted: false,
    version: 1,
    updatedAt: '2026-11-28T00:00:00Z',
    updatedBy: 'user',
    ...extra
  };
}

function recipe(name: string, extra: Partial<Recipe> = {}): Recipe {
  nextId += 1;
  return {
    id: `00000000-0000-4000-9000-${String(nextId).padStart(12, '0')}`,
    name,
    servings: 4,
    lines: [],
    notes: '',
    deleted: false,
    version: 1,
    updatedAt: '2026-11-28T00:00:00Z',
    updatedBy: 'user',
    ...extra
  };
}

const label = (i: { name: string; unit: string }) => `${i.name} · ${i.unit}`;

const catalogue = [
  ingredient('Tomato', 'each'),
  ingredient('Tomato', 'can'),
  ingredient('Tomato', 'kg'),
  ingredient('Milk', 'l'),
  ingredient('Mince', 'kg'),
  ingredient('Sugar', 'g'),
  ingredient('Cherry tomatoes', 'punnet'),
  ingredient('Chicken thighs', 'kg'),
  ingredient('Old spice', 'jar', { deleted: true })
];

describe('searchIngredients', () => {
  it.each(['tomatoe', 'tomatos', 'tomatp', 'tmato', 'tomato', 'TOMATO', '  tomato '])(
    'matches a misspelt "tomato" (%s)',
    (query) => {
      const results = searchIngredients(catalogue, query).map(label);
      expect(results).toEqual(
        expect.arrayContaining(['Tomato · can', 'Tomato · each', 'Tomato · kg'])
      );
    }
  );

  it('puts the closer name first', () => {
    // "tomatoe" is part of "Cherry tomatoes" exactly, but one letter off "Tomato".
    expect(searchIngredients(catalogue, 'tomatoe')[0]?.name).toBe('Cherry tomatoes');
    expect(searchIngredients(catalogue, 'tomatos')[0]?.name).toBe('Tomato');
    expect(searchIngredients(catalogue, 'tomato')[0]?.name).toBe('Tomato');
  });

  it('does not match "milk" to "mince"', () => {
    const results = searchIngredients(catalogue, 'milk');
    expect(results.map(label)).toEqual(['Milk · l']);
  });

  it('matches part of a longer name', () => {
    expect(searchIngredients(catalogue, 'thigh').map(label)).toEqual(['Chicken thighs · kg']);
  });

  it('keeps same-name items together, sorted by unit', () => {
    const results = searchIngredients(catalogue, 'tomato').map(label);
    expect(results.slice(0, 3)).toEqual(['Tomato · can', 'Tomato · each', 'Tomato · kg']);
    expect(results).toContain('Cherry tomatoes · punnet');
  });

  it('orders groups by their best score', () => {
    const results = searchIngredients(catalogue, 'tomato').map((i) => i.name);
    expect(results.indexOf('Tomato')).toBeLessThan(results.indexOf('Cherry tomatoes'));
  });

  it('groups names case-insensitively', () => {
    const mixed = [
      ingredient('Lemon', 'each'),
      ingredient('Lemonade', 'l'),
      ingredient('lemon', 'bag')
    ];
    expect(searchIngredients(mixed, 'lemon').map(label)).toEqual([
      'lemon · bag',
      'Lemon · each',
      'Lemonade · l'
    ]);
  });

  it('leaves out hidden items unless asked', () => {
    expect(searchIngredients(catalogue, 'spice')).toEqual([]);
    expect(searchIngredients(catalogue, 'spice', { includeHidden: true }).map(label)).toEqual([
      'Old spice · jar'
    ]);
  });

  it('returns everything for an empty query, sorted by name then unit', () => {
    expect(searchIngredients(catalogue, '  ').map(label)).toEqual([
      'Cherry tomatoes · punnet',
      'Chicken thighs · kg',
      'Milk · l',
      'Mince · kg',
      'Sugar · g',
      'Tomato · can',
      'Tomato · each',
      'Tomato · kg'
    ]);
    expect(searchIngredients(catalogue, '', { includeHidden: true })).toHaveLength(9);
  });

  it('applies a limit', () => {
    expect(searchIngredients(catalogue, 'tomato', { limit: 2 }).map(label)).toEqual([
      'Tomato · can',
      'Tomato · each'
    ]);
    expect(searchIngredients(catalogue, '', { limit: 1 })).toHaveLength(1);
  });

  it('sees a changed catalogue (a new array)', () => {
    const first = [ingredient('Basil', 'bunch')];
    expect(searchIngredients(first, 'basil')).toHaveLength(1);
    const second = [...first, ingredient('Basil', 'g')];
    expect(searchIngredients(second, 'basil')).toHaveLength(2);
  });
});

describe('searchRecipes', () => {
  const recipes = [
    recipe('Spaghetti bolognese'),
    recipe('Chicken curry'),
    recipe('Pancakes'),
    recipe('Fish pie', { deleted: true })
  ];

  it('matches a typo', () => {
    expect(searchRecipes(recipes, 'spagetti').map((r) => r.name)).toEqual(['Spaghetti bolognese']);
  });

  it('leaves out hidden recipes unless asked', () => {
    expect(searchRecipes(recipes, 'fish pie')).toEqual([]);
    expect(searchRecipes(recipes, 'fish pie', { includeHidden: true }).map((r) => r.name)).toEqual([
      'Fish pie'
    ]);
  });

  it('returns everything for an empty query, sorted by name', () => {
    expect(searchRecipes(recipes, '').map((r) => r.name)).toEqual([
      'Chicken curry',
      'Pancakes',
      'Spaghetti bolognese'
    ]);
  });

  it('applies a limit', () => {
    expect(searchRecipes(recipes, '', { limit: 2 })).toHaveLength(2);
  });
});

describe('suggestIngredients', () => {
  const common: CommonIngredient[] = [
    { name: 'Tomato', unit: 'each', shopSection: 'produce' },
    { name: 'Tomato', unit: 'can', shopSection: 'pantry' },
    { name: 'Tomato paste', unit: 'tube', shopSection: 'pantry' },
    { name: 'Milk', unit: 'l', shopSection: 'dairy' },
    { name: 'Old spice', unit: 'jar', shopSection: 'pantry' },
    { name: 'Sugar', unit: 'kg', shopSection: 'pantry' }
  ];

  it('fuzzy matches the common list', () => {
    expect(suggestIngredients(common, [], 'tomatoe').map(label)).toEqual([
      'Tomato · can',
      'Tomato · each',
      'Tomato paste · tube'
    ]);
  });

  it('leaves out names + units already in the catalogue, ignoring case and spaces', () => {
    const existing = [ingredient(' tomato ', 'EACH'), ingredient('Milk', 'l')];
    expect(suggestIngredients(common, existing, 'tomato').map(label)).toEqual([
      'Tomato · can',
      'Tomato paste · tube'
    ]);
    expect(suggestIngredients(common, existing, 'milk')).toEqual([]);
  });

  it('leaves out entries that exist but are hidden (show them again instead)', () => {
    const existing = [ingredient('Old spice', 'jar', { deleted: true })];
    expect(suggestIngredients(common, existing, 'spice')).toEqual([]);
  });

  it('keeps an entry whose name exists with another unit', () => {
    const existing = [ingredient('Sugar', 'g')];
    expect(suggestIngredients(common, existing, 'sugar').map(label)).toEqual(['Sugar · kg']);
  });

  it('suggests nothing for an empty query', () => {
    expect(suggestIngredients(common, [], ' ')).toEqual([]);
  });

  it('applies a limit', () => {
    expect(suggestIngredients(common, [], 'tomato', 1).map(label)).toEqual(['Tomato · can']);
  });
});

describe('isDuplicate', () => {
  const items = [ingredient('Sugar', 'g'), ingredient('Old spice', 'jar', { deleted: true })];

  it('finds the same name and unit, ignoring case and spaces', () => {
    expect(isDuplicate(items, '  sugar ', 'G')).toBe(true);
    expect(isDuplicate(items, 'Sugar', 'kg')).toBe(false);
    expect(isDuplicate(items, 'Brown sugar', 'g')).toBe(false);
  });

  it('includes hidden items', () => {
    expect(isDuplicate(items, 'old spice', 'jar')).toBe(true);
  });

  it('ignores the item being edited', () => {
    const sugar = items[0];
    expect(sugar).toBeDefined();
    expect(isDuplicate(items, 'Sugar', 'g', sugar?.id)).toBe(false);
  });
});

describe('unitSuggestions', () => {
  it('puts units already used for the name first, then the common list without repeats', () => {
    const items = [
      ingredient('Milk', 'l'),
      ingredient('milk', 'carton'),
      ingredient('Milk', 'ML'),
      ingredient('Mince', 'kg')
    ];
    expect(unitSuggestions(items, ' MILK ')).toEqual([
      'carton',
      'l',
      'ML',
      'g',
      'kg',
      'each',
      'can',
      'packet',
      'bottle',
      'bunch',
      'dozen'
    ]);
  });

  it('gives the common list for a new name', () => {
    expect(unitSuggestions([], 'Anything')).toEqual([...COMMON_UNITS]);
    expect(COMMON_UNITS).toEqual([
      'g',
      'kg',
      'ml',
      'l',
      'each',
      'can',
      'packet',
      'bottle',
      'bunch',
      'dozen'
    ]);
  });
});
