import { expect, test } from 'vitest';

test('throwaway failure (CI negative check)', () => {
  expect(1).toBe(2);
});
