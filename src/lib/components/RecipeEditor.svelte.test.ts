import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '#lib/i18n/en.js';
import type { Ingredient, Recipe } from '#lib/stores/catalogue.svelte.js';
import { ingredient, json, loadedCatalogue, recipe, stored, uuidV7 } from '#lib/test/catalogue.js';
import RecipeEditor from './RecipeEditor.svelte';

const flour = ingredient('Flour', 'g', { shopSection: 'pantry' });
const eggs = ingredient('Eggs', 'each', { shopSection: 'dairy' });
const milk = ingredient('Milk', 'ml', { shopSection: 'dairy' });
const lard = ingredient('Lard', 'g', { shopSection: 'dairy', deleted: true });
const pancakes = recipe('Pancakes', {
  servings: 4,
  notes: 'Whisk.',
  lines: [
    { ingredientId: flour.id, quantity: 200 },
    { ingredientId: eggs.id, quantity: 2 }
  ]
});
const noContent = () => new Response(null, { status: 204 });

async function setup(recipeId: string, recipes: Recipe[] = [pancakes]) {
  const ingredients: Ingredient[] = [flour, eggs, milk, lard];
  const env = await loadedCatalogue({ recipes, ingredients });
  const oncreated = vi.fn();
  render(RecipeEditor, { store: env.store, recipeId, common: [], oncreated });
  return { ...env, oncreated, user: userEvent.setup() };
}

const picker = (n: number) =>
  screen.getByRole('combobox', { name: t('recipe.ingredientLabel', { n }) });
const quantity = (n: number) => screen.getByLabelText(t('recipe.quantityLabel', { n }));
const button = (name: string) => screen.getByRole('button', { name });
const lines = () =>
  within(screen.getByRole('list', { name: t('recipe.lines') })).getAllByRole('listitem');

describe('RecipeEditor', () => {
  it('builds a new recipe with the keyboard: pick, quantity, Enter for the next line', async () => {
    const { user, reply, writes, oncreated } = await setup('new');
    reply('PUT', stored);

    await user.type(screen.getByLabelText(t('recipe.name')), 'Crepes');
    await user.clear(screen.getByLabelText(t('recipe.servings')));
    await user.type(screen.getByLabelText(t('recipe.servings')), '2');
    await user.click(picker(1));
    await user.keyboard('flour{ArrowDown}{Enter}');
    expect(document.activeElement).toBe(quantity(1));
    expect(within(lines()[0] as HTMLElement).getByText('g')).toBeTruthy();
    await user.keyboard('150{Enter}');

    expect(document.activeElement).toBe(picker(2));
    await user.keyboard('milk{ArrowDown}{Enter}300{Enter}');
    expect(lines()).toHaveLength(3);

    await user.type(screen.getByLabelText(t('recipe.notes')), 'Thin.');
    await user.click(button(t('recipe.save')));

    expect(writes()).toHaveLength(1);
    const [put] = writes();
    expect(put?.method).toBe('PUT');
    const id = put?.path.split('/').at(-1) ?? '';
    expect(put?.path).toBe(`/catalogue/recipes/${id}`);
    expect(id).toMatch(uuidV7);
    expect(put?.body).toEqual({
      name: 'Crepes',
      servings: 2,
      notes: 'Thin.',
      lines: [
        { ingredientId: flour.id, quantity: 150 },
        { ingredientId: milk.id, quantity: 300 }
      ],
      deleted: false,
      version: 0
    });
    expect(oncreated).toHaveBeenCalledWith(id);
  });

  it('edits an existing recipe and saves it with one PUT at its version', async () => {
    const { user, reply, writes, oncreated } = await setup(pancakes.id);
    reply(`PUT /catalogue/recipes/${pancakes.id}`, stored);

    expect(screen.getByLabelText<HTMLInputElement>(t('recipe.name')).value).toBe('Pancakes');
    expect((quantity(1) as HTMLInputElement).value).toBe('200');
    expect(
      screen.getByText(
        t('picker.option', { name: 'Eggs', unit: 'each', section: t('shopSections.dairy') })
      )
    ).toBeTruthy();
    await user.clear(quantity(2));
    await user.type(quantity(2), '3');
    await user.click(button(t('recipe.save')));

    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: `/catalogue/recipes/${pancakes.id}`,
        body: {
          name: 'Pancakes',
          servings: 4,
          notes: 'Whisk.',
          lines: [
            { ingredientId: flour.id, quantity: 200 },
            { ingredientId: eggs.id, quantity: 3 }
          ],
          deleted: false,
          version: 1
        }
      }
    ]);
    expect(oncreated).not.toHaveBeenCalled();
    expect(await screen.findByText(t('recipe.saved'))).toBeTruthy();
  });

  it('removes a line', async () => {
    const { user, reply, writes } = await setup(pancakes.id);
    reply('PUT', stored);

    await user.click(button(t('recipe.removeLabel', { n: 1 })));

    expect(lines()).toHaveLength(1);
    expect(screen.queryByText(/^Flour/)).toBeNull();
    await user.click(button(t('recipe.save')));
    expect((writes()[0]?.body as Recipe).lines).toEqual([{ ingredientId: eggs.id, quantity: 2 }]);
  });

  it('changes a line’s ingredient', async () => {
    const { user } = await setup(pancakes.id);

    await user.click(button(t('recipe.changeLabel', { n: 2 })));
    expect(document.activeElement).toBe(picker(2));
    await user.keyboard('milk{ArrowDown}{Enter}');

    expect(within(lines()[1] as HTMLElement).getByText('ml')).toBeTruthy();
  });

  it('allows each ingredient on one line only', async () => {
    const { user, reply, writes } = await setup(pancakes.id);
    reply('PUT', stored);

    await user.click(button(t('recipe.addLine')));
    expect(document.activeElement).toBe(picker(3));
    await user.keyboard('eggs{ArrowDown}{Enter}');

    expect(screen.getByRole('alert').textContent).toBe(
      t('recipe.alreadyUsed', { name: 'Eggs', unit: 'each', n: 2 })
    );
    expect(picker(3)).toBeTruthy();
    expect(document.activeElement).toBe(picker(3));

    await user.click(button(t('recipe.save')));
    expect((writes()[0]?.body as Recipe).lines).toHaveLength(2);
  });

  it('shows a hidden ingredient already on a line, marked hidden', async () => {
    await setup('x', [
      recipe('Pastry', { id: 'x', lines: [{ ingredientId: lard.id, quantity: 50 }] })
    ]);

    expect(within(lines()[0] as HTMLElement).getByText(t('recipe.hiddenIngredient'))).toBeTruthy();
    expect(within(lines()[0] as HTMLElement).getByText(/^Lard/)).toBeTruthy();
  });

  it('checks the fields before saving, inline', async () => {
    const { user, writes } = await setup('new');

    await user.clear(screen.getByLabelText(t('recipe.servings')));
    await user.type(screen.getByLabelText(t('recipe.servings')), '0');
    await user.click(picker(1));
    await user.keyboard('flour{ArrowDown}{Enter}');
    await user.click(button(t('recipe.save')));

    expect(writes()).toHaveLength(0);
    const name = screen.getByLabelText(t('recipe.name'));
    expect(document.activeElement).toBe(name);
    const described = (field: HTMLElement) =>
      (field.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(described(name)).toBe(t('recipe.errors.nameRequired'));
    expect(described(screen.getByLabelText(t('recipe.servings')))).toBe(
      t('recipe.errors.servingsRequired')
    );
    expect(quantity(1).getAttribute('aria-invalid')).toBe('true');
    expect(described(quantity(1))).toContain(t('recipe.errors.quantityRequired'));
  });

  it('hides a recipe, and shows it again', async () => {
    const { user, reply, writes } = await setup(pancakes.id);
    reply(`DELETE /catalogue/recipes/${pancakes.id}`, noContent());
    reply(
      'GET /catalogue',
      json(200, { recipes: [{ ...pancakes, deleted: true, version: 2 }], ingredients: [] })
    );
    reply(`PUT /catalogue/recipes/${pancakes.id}`, stored);

    await user.click(button(t('recipe.hide')));
    expect(screen.getByText(t('recipe.hiddenNote'))).toBeTruthy();
    await user.click(button(t('recipe.showAgain')));

    expect(writes().map((w) => w.method)).toEqual(['DELETE', 'PUT']);
    expect(writes()[1]?.body).toMatchObject({ deleted: false, version: 2 });
    expect(screen.queryByText(t('recipe.hiddenNote'))).toBeNull();
    expect(document.activeElement).toBe(button(t('recipe.hide')));
  });

  it('says when the recipe doesn’t exist', async () => {
    await setup('0190a0b0-0000-7000-8000-00000000dead');

    expect(screen.getByRole('heading', { name: t('recipe.notFound.heading') })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('recipe.back') }).getAttribute('href')).toBe(
      '/recipes'
    );
  });
});
