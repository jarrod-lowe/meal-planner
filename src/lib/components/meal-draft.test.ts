import { describe, expect, it } from 'vitest';
import { mealErrors, mealFields, suggestName, type MealDraft } from './meal-draft.js';

const draft: MealDraft = {
  name: ' Feast ',
  slot: 'dinner',
  date: '2027-01-01',
  time: '18:30',
  recipeId: null,
  attendeeIds: ['b', 'gone', 'a']
};

describe('suggestName', () => {
  it('uses the short date and the slot', () => {
    expect(suggestName('2027-01-01', 'dinner')).toBe('1 Jan Dinner');
  });

  it('falls back to the slot without a date', () => {
    expect(suggestName('', 'lunch')).toBe('Lunch');
  });
});

describe('mealErrors', () => {
  it('needs a name, a real date and a time', () => {
    expect(mealErrors(draft)).toEqual({});
    expect(mealErrors({ ...draft, name: ' ', date: '2027-02-30', time: '24:00' })).toEqual({
      name: 'nameRequired',
      date: 'dateRequired',
      time: 'timeRequired'
    });
  });
});

describe('mealFields', () => {
  it('trims the name, keeps known attendees in the holiday’s order and later mealtimes', () => {
    const later = { id: 'm2', at: '2027-01-02T18:30', attendeeIds: ['a'] };
    expect(mealFields(draft, { id: 'm1', rest: [later] }, [{ id: 'a' }, { id: 'b' }])).toEqual({
      name: 'Feast',
      slot: 'dinner',
      recipeId: null,
      mealtimes: [{ id: 'm1', at: '2027-01-01T18:30', attendeeIds: ['a', 'b'] }, later]
    });
  });
});
