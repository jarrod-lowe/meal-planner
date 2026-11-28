import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '#lib/i18n/en.js';
import type { Recipe } from '#lib/stores/catalogue.svelte.js';
import { loadedCatalogue, recipe } from '#lib/test/catalogue.js';
import RecipePicker from './RecipePicker.svelte';

const label = 'Recipe';
const pancakes = recipe('Pancakes', { servings: 4 });
const pasta = recipe('Pasta bake', { servings: 6 });
const gruel = recipe('Gruel', { deleted: true });

async function setup() {
  const env = await loadedCatalogue({ recipes: [pancakes, pasta, gruel] });
  const onselect = vi.fn<(recipe: Recipe) => void>();
  const oncreate = vi.fn<(query: string) => void>();
  render(RecipePicker, { store: env.store, label, onselect, oncreate });
  const input = screen.getByRole('combobox', { name: label });
  return { ...env, onselect, oncreate, input, user: userEvent.setup() };
}

const options = () => within(screen.getByRole('listbox')).getAllByRole('option');

describe('RecipePicker', () => {
  it('fuzzy matches recipes that aren’t hidden, then offers to create one', async () => {
    const { input, user } = await setup();

    await user.type(input, 'pancaks');

    expect(input.getAttribute('aria-expanded')).toBe('true');
    const texts = options().map((option) => option.textContent?.trim());
    expect(texts[0]).toBe(t('recipePicker.option', { name: 'Pancakes', servings: 4 }));
    expect(texts.at(-1)).toBe(t('recipePicker.create', { query: 'pancaks' }));
    expect(texts.some((text) => text?.startsWith('Pasta'))).toBe(false);

    await user.clear(input);
    await user.type(input, 'gruel');
    expect(options()).toHaveLength(1);
  });

  it('selects with the arrow keys and Enter', async () => {
    const { input, user, onselect } = await setup();

    await user.type(input, 'pa');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(active ?? '')?.textContent).toContain('Pasta bake');
    await user.keyboard('{Enter}');

    expect(onselect).toHaveBeenCalledWith(pasta);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('closes with Escape', async () => {
    const { input, user } = await setup();

    await user.type(input, 'pa{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects with a click', async () => {
    const { input, user, onselect } = await setup();

    await user.type(input, 'pancakes');
    await user.click(
      screen.getByRole('option', {
        name: t('recipePicker.option', { name: 'Pancakes', servings: 4 })
      })
    );

    expect(onselect).toHaveBeenCalledWith(pancakes);
  });

  it('calls oncreate with the query from the create option', async () => {
    const { input, user, oncreate, onselect } = await setup();

    await user.type(input, '  Lasagne ');
    await user.keyboard('{ArrowUp}{Enter}');

    expect(oncreate).toHaveBeenCalledWith('Lasagne');
    expect(onselect).not.toHaveBeenCalled();
  });
});
