import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHOP_SECTIONS } from './sections.js';

// The ShopSection enum as written in openapi.yaml, in order.
function openapiShopSections(): string[] {
  const spec = readFileSync('terraform/module/meal-planner/openapi.yaml', 'utf8');
  const block = /^ {4}ShopSection:\n(?:^ {6}.*\n)*?^ {6}enum:\n((?:^ {8}- .*\n)+)/m.exec(spec);
  if (!block?.[1]) throw new Error('ShopSection enum not found in openapi.yaml');
  return block[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*- /, '').trim());
}

describe('SHOP_SECTIONS', () => {
  it('matches the openapi ShopSection enum, in shopping-list order', () => {
    expect([...SHOP_SECTIONS]).toEqual(openapiShopSections());
  });
});
