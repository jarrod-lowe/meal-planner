import { describe, expect, it } from 'vitest';
import { mealReturn, withoutRecipe, withRecipe } from './meal-return.js';

const holiday = '0190a0b0-0000-7000-8000-000000000001';
const meal = '0190a0b0-0000-7000-8000-0000000000c1';

describe('mealReturn', () => {
  it.each([
    [`/holidays/${holiday}/meals/new`],
    [`/holidays/${holiday}/meals/new?date=2027-01-01&slot=dinner`],
    [`/holidays/${holiday}/meals/${meal}`]
  ])('allows the meal editor path %s', (path) => {
    expect(mealReturn(path)).toBe(path);
  });

  it.each([
    [null],
    [''],
    ['/'],
    ['/recipes'],
    [`/holidays/${holiday}`],
    [`/holidays/${holiday}/plan`],
    [`/holidays/${holiday}/meals/${meal}/extra`],
    [`/holidays/not-a-uuid/meals/new`],
    [`/holidays/${holiday}/meals/not-a-uuid`],
    [`//evil.com/holidays/${holiday}/meals/new`],
    [`https://evil.com/holidays/${holiday}/meals/new`],
    [`/\\evil.com/holidays/${holiday}/meals/new`],
    [`/holidays/${holiday}/meals/new#x`],
    [`javascript:alert(1)//holidays/${holiday}/meals/new`]
  ])('rejects %j', (path) => {
    expect(mealReturn(path)).toBeNull();
  });
});

describe('withRecipe', () => {
  it('adds the recipe, keeping the query', () => {
    expect(withRecipe(`/holidays/${holiday}/meals/new?date=2027-01-01&slot=dinner`, 'r1')).toBe(
      `/holidays/${holiday}/meals/new?date=2027-01-01&slot=dinner&recipe=r1`
    );
    expect(withRecipe(`/holidays/${holiday}/meals/${meal}`, 'r1')).toBe(
      `/holidays/${holiday}/meals/${meal}?recipe=r1`
    );
  });

  it('replaces a recipe already there', () => {
    expect(withRecipe(`/holidays/${holiday}/meals/${meal}?recipe=old`, 'r2')).toBe(
      `/holidays/${holiday}/meals/${meal}?recipe=r2`
    );
  });
});

describe('withoutRecipe', () => {
  it('drops the recipe, keeping the rest of the query', () => {
    expect(withoutRecipe(`/holidays/${holiday}/meals/new?date=2027-01-01&recipe=r1`)).toBe(
      `/holidays/${holiday}/meals/new?date=2027-01-01`
    );
    expect(withoutRecipe(`/holidays/${holiday}/meals/${meal}?recipe=r1`)).toBe(
      `/holidays/${holiday}/meals/${meal}`
    );
  });
});
