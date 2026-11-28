import { describe, expect, it } from 'vitest';
import { nameError } from './names';

describe('nameError', () => {
  it('accepts 1 to 100 characters once trimmed', () => {
    expect(nameError(' a ')).toBeNull();
    expect(nameError('x'.repeat(100))).toBeNull();
  });

  it('rejects an empty or blank name', () => {
    expect(nameError('')).toBe('nameRequired');
    expect(nameError('   ')).toBe('nameRequired');
  });

  it('rejects more than 100 characters', () => {
    expect(nameError('x'.repeat(101))).toBe('nameTooLong');
  });
});
