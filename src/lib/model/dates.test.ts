import { describe, expect, it } from 'vitest';
import { addDays, datesFrom, isLocalDate } from './dates.js';

describe('addDays', () => {
  it('moves across months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('datesFrom', () => {
  it('lists every date from start to end, inclusive', () => {
    expect(datesFrom('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02'
    ]);
  });

  it('gives one date for a one-day range and none for a backwards one', () => {
    expect(datesFrom('2027-01-01', '2027-01-01')).toEqual(['2027-01-01']);
    expect(datesFrom('2027-01-02', '2027-01-01')).toEqual([]);
  });
});

describe('isLocalDate', () => {
  it('accepts real dates only', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
    expect(isLocalDate('2027-1-01')).toBe(false);
    expect(isLocalDate('')).toBe(false);
  });
});
