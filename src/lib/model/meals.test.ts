import { describe, expect, it } from 'vitest';
import { servings } from './meals.js';

describe('servings', () => {
  it('counts the attendees who still exist, once each', () => {
    const attendees = [{ id: 'a' }, { id: 'b' }];
    expect(servings({ attendeeIds: ['a', 'b', 'gone', 'a'] }, attendees)).toBe(2);
    expect(servings({ attendeeIds: [] }, attendees)).toBe(0);
  });
});
