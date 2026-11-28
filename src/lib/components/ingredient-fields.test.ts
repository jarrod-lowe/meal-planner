import { describe, expect, it } from 'vitest';
import { ingredientErrors } from './ingredient-fields.js';

describe('ingredientErrors', () => {
  it('accepts a trimmed name of 1–100 and unit of 1–20 characters', () => {
    expect(ingredientErrors({ name: ' Sugar ', unit: ' g ' })).toEqual({});
    expect(ingredientErrors({ name: 'a'.repeat(100), unit: 'u'.repeat(20) })).toEqual({});
  });

  it('needs a name and a unit', () => {
    expect(ingredientErrors({ name: '  ', unit: '' })).toEqual({
      name: 'nameRequired',
      unit: 'unitRequired'
    });
  });

  it('limits their lengths', () => {
    expect(ingredientErrors({ name: 'a'.repeat(101), unit: 'u'.repeat(21) })).toEqual({
      name: 'nameTooLong',
      unit: 'unitTooLong'
    });
  });
});
