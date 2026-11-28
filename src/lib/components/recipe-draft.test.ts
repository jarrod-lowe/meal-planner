import { describe, expect, it } from 'vitest';
import { recipeErrors, recipeFields, type RecipeDraft } from './recipe-draft.js';

const draft = (overrides: Partial<RecipeDraft> = {}): RecipeDraft => ({
  name: ' Pancakes ',
  servings: 4,
  notes: 'Mix.',
  lines: [
    { key: 'a', ingredientId: 'flour', quantity: 200 },
    { key: 'b', ingredientId: 'eggs', quantity: 2 }
  ],
  ...overrides
});

describe('recipeErrors', () => {
  it('accepts a good draft', () => {
    expect(recipeErrors(draft())).toEqual({ lines: {} });
  });

  it('needs a name of up to 100 characters', () => {
    expect(recipeErrors(draft({ name: '  ' })).name).toBe('nameRequired');
    expect(recipeErrors(draft({ name: 'a'.repeat(101) })).name).toBe('nameTooLong');
  });

  it('needs servings above 0', () => {
    expect(recipeErrors(draft({ servings: null })).servings).toBe('servingsRequired');
    expect(recipeErrors(draft({ servings: 0 })).servings).toBe('servingsRequired');
    expect(recipeErrors(draft({ servings: 0.5 })).servings).toBeUndefined();
  });

  it('limits notes to 10,000 characters', () => {
    expect(recipeErrors(draft({ notes: 'n'.repeat(10_000) })).notes).toBeUndefined();
    expect(recipeErrors(draft({ notes: 'n'.repeat(10_001) })).notes).toBe('notesTooLong');
  });

  it('needs an ingredient and a quantity above 0 on each line, ignoring blank lines', () => {
    const errors = recipeErrors(
      draft({
        lines: [
          { key: 'a', ingredientId: null, quantity: 2 },
          { key: 'b', ingredientId: 'eggs', quantity: 0 },
          { key: 'c', ingredientId: 'milk', quantity: null },
          { key: 'd', ingredientId: null, quantity: null }
        ]
      })
    );
    expect(errors.lines).toEqual({
      a: { ingredient: 'ingredientRequired' },
      b: { quantity: 'quantityRequired' },
      c: { quantity: 'quantityRequired' }
    });
  });

  it('allows up to 200 lines', () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        key: `${i}`,
        ingredientId: `i${i}`,
        quantity: 1
      }));
    expect(recipeErrors(draft({ lines: lines(200) })).tooManyLines).toBeUndefined();
    expect(recipeErrors(draft({ lines: lines(201) })).tooManyLines).toBe(true);
  });
});

describe('recipeFields', () => {
  it('trims the name and drops blank lines', () => {
    expect(
      recipeFields(
        draft({ lines: [...draft().lines, { key: 'c', ingredientId: null, quantity: null }] }),
        false
      )
    ).toEqual({
      name: 'Pancakes',
      servings: 4,
      notes: 'Mix.',
      lines: [
        { ingredientId: 'flour', quantity: 200 },
        { ingredientId: 'eggs', quantity: 2 }
      ],
      deleted: false
    });
  });

  it('keeps the recipe hidden if it was', () => {
    expect(recipeFields(draft(), true).deleted).toBe(true);
  });
});
