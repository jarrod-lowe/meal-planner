import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '#lib/i18n/en.js';
import type { Recipe } from '#lib/stores/catalogue.svelte.js';
import { loadedCatalogue, recipe, stored } from '#lib/test/catalogue.js';
import RecipeList from './RecipeList.svelte';

const line = (ingredientId: string) => ({ ingredientId, quantity: 1 });
const pancakes = recipe('Pancakes', { servings: 4, lines: [line('a'), line('b')] });
const porridge = recipe('Porridge', { servings: 1, lines: [line('a')] });
const gruel = recipe('Gruel', { servings: 2, deleted: true });

async function setup(recipes: Recipe[] = [pancakes, porridge, gruel]) {
  const env = await loadedCatalogue({ recipes });
  render(RecipeList, { store: env.store });
  return { ...env, user: userEvent.setup() };
}

const list = () => screen.getByRole('list', { name: t('recipes.heading') });
const names = () =>
  within(list())
    .getAllByRole('link')
    .map((link) => link.textContent?.trim());

describe('RecipeList', () => {
  it('lists recipes by name with servings and ingredient counts, leaving out hidden ones', async () => {
    await setup();

    expect(names()).toEqual(['Pancakes', 'Porridge']);
    const link = within(list()).getByRole('link', { name: 'Pancakes' });
    expect(link.getAttribute('href')).toBe(`/recipes/${pancakes.id}`);
    const item = link.closest('li') as HTMLElement;
    expect(
      within(item).getByText(t('recipes.serves', { count: 4 }), { exact: false })
    ).toBeTruthy();
    expect(
      within(item).getByText(t('recipes.ingredientCount', { count: 2 }), { exact: false })
    ).toBeTruthy();
    const single = within(list())
      .getByRole('link', { name: 'Porridge' })
      .closest('li') as HTMLElement;
    expect(within(single).getByText(t('recipes.oneIngredient'), { exact: false })).toBeTruthy();
  });

  it('links to a new recipe', async () => {
    await setup();

    expect(screen.getByRole('link', { name: t('recipes.new') }).getAttribute('href')).toBe(
      '/recipes/new'
    );
  });

  it('searches by name', async () => {
    const { user } = await setup();

    await user.type(screen.getByRole('searchbox', { name: t('recipes.search') }), 'porrige');

    expect(names()).toEqual(['Porridge']);
  });

  it('says when nothing matches, and when there are none', async () => {
    const { user } = await setup();
    await user.type(screen.getByRole('searchbox', { name: t('recipes.search') }), 'qqqq');
    expect(screen.getByText(t('recipes.noMatches', { query: 'qqqq' }))).toBeTruthy();
  });

  it('says when there are no recipes', async () => {
    await setup([]);
    expect(screen.getByText(t('recipes.empty'))).toBeTruthy();
  });

  it('shows hidden recipes, marked hidden, and shows one again', async () => {
    const { user, reply, writes } = await setup();
    reply(`PUT /catalogue/recipes/${gruel.id}`, stored);

    await user.click(screen.getByRole('checkbox', { name: t('recipes.showHidden') }));
    expect(names()).toEqual(['Gruel', 'Pancakes', 'Porridge']);
    const item = within(list()).getByRole('link', { name: 'Gruel' }).closest('li') as HTMLElement;
    expect(within(item).getByText(t('recipes.hidden'))).toBeTruthy();

    await user.click(
      within(item).getByRole('button', { name: t('recipes.showAgainLabel', { name: 'Gruel' }) })
    );

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.body).toMatchObject({ name: 'Gruel', deleted: false, version: 1 });
    expect(within(item).queryByText(t('recipes.hidden'))).toBeNull();
  });
});
