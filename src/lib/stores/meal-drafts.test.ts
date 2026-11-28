import { describe, expect, it } from 'vitest';
import { MealDrafts, mealDraftKey, type MealStash } from './meal-drafts.js';

const stash: MealStash = {
  id: 'meal-1',
  mealtimeId: 'mealtime-1',
  draft: {
    name: 'Feast',
    slot: 'dinner',
    date: '2027-01-01',
    time: '19:00',
    recipeId: null,
    attendeeIds: ['a']
  },
  nameEdited: true,
  timeEdited: true,
  base: { version: undefined, fields: '{}' }
};

describe('MealDrafts', () => {
  it('gives a stashed draft back once', () => {
    const drafts = new MealDrafts();
    drafts.put('k', stash);
    expect(drafts.take('k')).toEqual(stash);
    expect(drafts.take('k')).toBeUndefined();
  });

  it('keeps a copy, so later edits to the draft don’t change it', () => {
    const drafts = new MealDrafts();
    const draft = { ...stash.draft, attendeeIds: ['a'] };
    drafts.put('k', { ...stash, draft });
    draft.attendeeIds.push('b');
    draft.name = 'Changed';
    expect(drafts.take('k')?.draft).toEqual(stash.draft);
  });

  it('clears a stash', () => {
    const drafts = new MealDrafts();
    drafts.put('k', stash);
    drafts.clear('k');
    expect(drafts.take('k')).toBeUndefined();
  });

  it('keys by holiday and meal, and a new meal also by its date and slot', () => {
    expect(mealDraftKey('h', 'm', '2027-01-01', 'lunch')).toBe(mealDraftKey('h', 'm', null, null));
    expect(mealDraftKey('h', 'm', null, null)).not.toBe(mealDraftKey('h', 'n', null, null));
    expect(mealDraftKey('h', 'm', null, null)).not.toBe(mealDraftKey('g', 'm', null, null));
    expect(mealDraftKey('h', 'new', '2027-01-01', 'lunch')).not.toBe(
      mealDraftKey('h', 'new', '2027-01-02', 'lunch')
    );
    expect(mealDraftKey('h', 'new', '2027-01-01', 'lunch')).not.toBe(
      mealDraftKey('h', 'new', '2027-01-01', 'dinner')
    );
    expect(mealDraftKey('h', 'new', '2027-01-01', 'lunch')).toBe(
      mealDraftKey('h', 'new', '2027-01-01', 'lunch')
    );
  });
});
