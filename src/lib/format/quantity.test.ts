import { describe, expect, it } from 'vitest';
import { formatQuantity } from './quantity.js';

describe('formatQuantity', () => {
  it('shows at most 2 decimal places, trimming trailing zeros (DESIGN §1)', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(1 / 3)).toBe('0.33');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(2.004)).toBe('2');
    expect(formatQuantity(0.125)).toBe('0.13');
  });

  it('doesn’t group thousands', () => {
    expect(formatQuantity(1250)).toBe('1250');
  });
});
