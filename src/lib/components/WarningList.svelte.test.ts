import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Schemas } from '#lib/api/client.js';
import type { Warning } from '#lib/engine/index.js';
import { t } from '#lib/i18n/en.js';
import { recipe } from '#lib/test/catalogue.js';
import { holidayId, meta } from '#lib/test/holiday.js';
import WarningList from './WarningList.svelte';

const pie = recipe('Pie');
const goneRecipe = '0190a0b0-0000-7000-8000-0000000000e1';
const goneIngredient = '0190a0b0-0000-7000-8000-0000000000e2';
const feast: Schemas['Meal'] = {
  id: '0190a0b0-0000-7000-8000-0000000000c1',
  name: 'Feast',
  slot: 'dinner',
  recipeId: null,
  mealtimes: [
    { id: '0190a0b0-0000-7000-8000-0000000000d1', at: '2027-01-01T18:30', attendeeIds: [] }
  ],
  version: 1,
  ...meta
};
const mealPath = `/holidays/${holidayId}/meals/${feast.id}`;

function show(warnings: Warning[]) {
  render(WarningList, { holidayId, warnings, meals: [feast], recipes: [pie] });
  const items = () => screen.queryAllByRole('listitem');
  return { items };
}

const only = (items: HTMLElement[]) => {
  expect(items).toHaveLength(1);
  return items[0] as HTMLElement;
};
const linkIn = (item: HTMLElement) => within(item).getByRole('link');

describe('WarningList', () => {
  it('says when there are no warnings', () => {
    show([]);

    expect(screen.getByText(t('overview.warnings.none'))).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('links a meal without a recipe to its editor', () => {
    const { items } = show([{ code: 'meal-without-recipe', mealId: feast.id }]);

    const item = only(items());
    expect(item.textContent).toContain(t('overview.warnings.mealWithoutRecipe', { meal: 'Feast' }));
    const link = linkIn(item);
    expect(link.getAttribute('href')).toBe(mealPath);
    expect(link.getAttribute('aria-label')).toBe(
      t('overview.warnings.chooseRecipeLabel', { meal: 'Feast' })
    );
  });

  it('links a mealtime no one eats to the meal’s editor', () => {
    const { items } = show([
      {
        code: 'mealtime-without-attendees',
        mealId: feast.id,
        mealtimeId: feast.mealtimes[0]?.id ?? ''
      }
    ]);

    const item = only(items());
    expect(item.textContent).toContain(
      t('overview.warnings.mealtimeWithoutAttendees', { meal: 'Feast', day: 'Fri 1 Jan' })
    );
    expect(linkIn(item).getAttribute('href')).toBe(mealPath);
  });

  it('links a meal whose recipe is gone to its editor', () => {
    const { items } = show([{ code: 'missing-recipe', mealId: feast.id, recipeId: goneRecipe }]);

    const item = only(items());
    expect(item.textContent).toContain(t('overview.warnings.missingRecipe', { meal: 'Feast' }));
    expect(item.textContent).toContain('a recipe that no longer exists');
    expect(linkIn(item).getAttribute('href')).toBe(mealPath);
  });

  it('links a recipe with a missing ingredient to the recipe editor', () => {
    const { items } = show([
      { code: 'missing-ingredient', ingredientId: goneIngredient, recipeId: pie.id }
    ]);

    const item = only(items());
    expect(item.textContent).toContain(t('overview.warnings.missingIngredient', { recipe: 'Pie' }));
    expect(item.textContent).toContain('an ingredient that no longer exists');
    expect(linkIn(item).getAttribute('href')).toBe(`/recipes/${pie.id}`);
    expect(linkIn(item).getAttribute('aria-label')).toBe(
      t('overview.warnings.fixRecipeLabel', { recipe: 'Pie' })
    );
  });

  it('lists several warnings in the plan’s order', () => {
    const { items } = show([
      { code: 'meal-without-recipe', mealId: feast.id },
      { code: 'missing-ingredient', ingredientId: goneIngredient, recipeId: pie.id }
    ]);

    expect(items()).toHaveLength(2);
    expect(items()[1]?.textContent).toContain('Pie');
  });
});
