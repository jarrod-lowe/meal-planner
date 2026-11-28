import { describe, expect, it } from 'vitest';
import common from '#data/common-ingredients.json';
import { SHOP_SECTIONS } from '#lib/model/sections.js';

const sections: readonly string[] = SHOP_SECTIONS;

describe('data/common-ingredients.json', () => {
  it('has about 150 entries', () => {
    expect(common.length).toBeGreaterThanOrEqual(120);
    expect(common.length).toBeLessThanOrEqual(200);
  });

  it.each(common.map((entry, i) => [i, entry] as const))('entry %i is valid', (_, entry) => {
    expect(Object.keys(entry).sort()).toEqual(['name', 'shopSection', 'unit']);
    expect(entry.name.trim()).toBe(entry.name);
    expect(entry.name.length).toBeGreaterThanOrEqual(1);
    expect(entry.name.length).toBeLessThanOrEqual(100);
    expect(entry.unit.trim()).toBe(entry.unit);
    expect(entry.unit.length).toBeGreaterThanOrEqual(1);
    expect(entry.unit.length).toBeLessThanOrEqual(20);
    expect(sections).toContain(entry.shopSection);
  });

  it('has no duplicate name + unit pairs', () => {
    const keys = common.map((e) => `${e.name.toLowerCase()}\u0000${e.unit.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is sorted by shop section, then name, then unit', () => {
    const sorted = [...common].sort(
      (a, b) =>
        sections.indexOf(a.shopSection) - sections.indexOf(b.shopSection) ||
        a.name.localeCompare(b.name) ||
        a.unit.localeCompare(b.unit)
    );
    expect(common).toEqual(sorted);
  });
});
