import { describe, expect, it } from 'vitest';
import { formatDate, formatDateRange, formatDay, formatShortDate } from './dates';

describe('formatDate', () => {
  it('formats a LocalDate without shifting it by the time zone', () => {
    expect(formatDate('2027-01-01')).toBe('1 Jan 2027');
  });
});

describe('formatDateRange', () => {
  it('shares the month and year within one month', () => {
    expect(formatDateRange('2026-12-26', '2026-12-31')).toBe('26 – 31 Dec 2026');
  });

  it('spans years', () => {
    expect(formatDateRange('2026-12-26', '2027-01-02')).toBe('26 Dec 2026 – 2 Jan 2027');
  });

  it('shows one date for a one-day holiday', () => {
    expect(formatDateRange('2027-01-01', '2027-01-01')).toBe('1 Jan 2027');
  });
});

describe('formatShortDate', () => {
  it('gives the day and short month, without the year', () => {
    expect(formatShortDate('2027-01-01')).toBe('1 Jan');
    expect(formatShortDate('2026-12-26')).toBe('26 Dec');
  });
});

describe('formatDay', () => {
  it('gives the weekday, day and short month', () => {
    expect(formatDay('2026-12-26')).toBe('Sat 26 Dec');
  });
});
