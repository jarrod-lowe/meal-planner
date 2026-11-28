import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEAL_SLOTS, SLOT_DEFAULT_TIMES } from './slots.js';

// The MealSlot enum as written in openapi.yaml, in order.
function openapiMealSlots(): string[] {
  const spec = readFileSync('terraform/module/meal-planner/openapi.yaml', 'utf8');
  const block = /^ {4}MealSlot:\n(?:^ {6}.*\n)*?^ {6}enum:\n((?:^ {8}- .*\n)+)/m.exec(spec);
  if (!block?.[1]) throw new Error('MealSlot enum not found in openapi.yaml');
  return block[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*- /, '').trim());
}

describe('MEAL_SLOTS', () => {
  it('matches the openapi MealSlot enum, in grid-column order', () => {
    expect([...MEAL_SLOTS]).toEqual(openapiMealSlots());
  });
});

describe('SLOT_DEFAULT_TIMES', () => {
  it('gives each slot its DESIGN §2.1 default time', () => {
    expect(SLOT_DEFAULT_TIMES).toEqual({
      breakfast: '08:00',
      lunch: '12:30',
      dinner: '18:30',
      snacks: '15:00',
      other: '12:00'
    });
  });

  it('has an HH:mm time for every slot and nothing else', () => {
    expect(Object.keys(SLOT_DEFAULT_TIMES).sort()).toEqual([...MEAL_SLOTS].sort());
    for (const time of Object.values(SLOT_DEFAULT_TIMES)) {
      expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });
});
