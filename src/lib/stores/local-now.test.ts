import { describe, expect, it } from 'vitest';
import { localNow } from './local-now.js';

const at = (iso: string) => new Date(iso);

describe('localNow', () => {
  it('gives the holiday-local date and time in another time zone', () => {
    expect(localNow(at('2026-12-26T05:07:00Z'), 'Pacific/Auckland')).toBe('2026-12-26T18:07');
    expect(localNow(at('2026-12-26T05:07:00Z'), 'America/New_York')).toBe('2026-12-26T00:07');
  });

  it('crosses midnight into the next day, month and year', () => {
    expect(localNow(at('2026-12-31T10:59:00Z'), 'Pacific/Auckland')).toBe('2026-12-31T23:59');
    expect(localNow(at('2026-12-31T11:00:00Z'), 'Pacific/Auckland')).toBe('2027-01-01T00:00');
  });

  it('uses 00 for midnight, never 24', () => {
    expect(localNow(at('2027-01-01T00:00:30Z'), 'UTC')).toBe('2027-01-01T00:00');
  });

  it('jumps over the hour daylight saving skips', () => {
    // New Zealand clocks go from 02:00 NZST to 03:00 NZDT on 27 Sep 2026.
    expect(localNow(at('2026-09-26T13:59:00Z'), 'Pacific/Auckland')).toBe('2026-09-27T01:59');
    expect(localNow(at('2026-09-26T14:00:00Z'), 'Pacific/Auckland')).toBe('2026-09-27T03:00');
  });

  it('repeats the hour when daylight saving ends', () => {
    // 3:00 NZDT goes back to 2:00 NZST on 5 Apr 2026.
    expect(localNow(at('2026-04-04T13:30:00Z'), 'Pacific/Auckland')).toBe('2026-04-05T02:30');
    expect(localNow(at('2026-04-04T14:30:00Z'), 'Pacific/Auckland')).toBe('2026-04-05T02:30');
  });
});
