import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CommonIngredient } from '#lib/catalogue/search.js';
import { t } from '#lib/i18n/en.js';
import type { Ingredient } from '#lib/stores/catalogue.svelte.js';
import {
  apiError,
  ingredient,
  json,
  loadedCatalogue,
  stored,
  uuidV7
} from '#lib/test/catalogue.js';
import IngredientPicker from './IngredientPicker.svelte';

const label = 'Ingredient';
const sugar = ingredient('Sugar', 'g', { shopSection: 'pantry' });
const tomato = ingredient('Tomato', 'each', { shopSection: 'produce' });
const oldSpice = ingredient('Old spice', 'jar', { deleted: true });
const common: CommonIngredient[] = [
  { name: 'Basil', unit: 'bunch', shopSection: 'produce' },
  { name: 'Sugar', unit: 'g', shopSection: 'pantry' },
  { name: 'Sugar', unit: 'kg', shopSection: 'pantry' }
];

async function setup(ingredients = [sugar, tomato, oldSpice]) {
  const env = await loadedCatalogue({ ingredients });
  const onselect = vi.fn<(ingredient: Ingredient) => void>();
  render(IngredientPicker, { store: env.store, common, label, onselect });
  const input = screen.getByRole('combobox', { name: label });
  return { ...env, onselect, input, user: userEvent.setup() };
}

const optionText = (name: string, unit: string, section: string) =>
  t('picker.option', { name, unit, section });
const listbox = () => screen.getByRole('listbox');
const options = () => within(listbox()).getAllByRole('option');

describe('IngredientPicker', () => {
  it('is a collapsed combobox until you type', async () => {
    const { input } = await setup();

    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('fuzzy matches catalogue ingredients, shown as name · unit · section', async () => {
    const { input, user } = await setup();

    await user.type(input, 'tomatp');

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox().id);
    const names = options().map((option) => option.textContent?.trim());
    expect(names).toContain(optionText('Tomato', 'each', t('shopSections.produce')));
    expect(names.some((name) => name?.startsWith('Sugar'))).toBe(false);
  });

  it('leaves out hidden ingredients', async () => {
    const { input, user } = await setup();

    await user.type(input, 'old spice');

    expect(within(listbox()).queryByRole('option', { name: /Old spice · jar/ })).toBeNull();
  });

  it('moves through the options with the arrow keys and selects with Enter', async () => {
    const { input, user, onselect } = await setup();

    await user.type(input, 'sugar');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);

    await user.keyboard('{ArrowDown}');
    const [first, second] = options();
    expect(input.getAttribute('aria-activedescendant')).toBe(first?.id);
    expect(first?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(second?.id);
    await user.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(first?.id);

    await user.keyboard('{Enter}');

    expect(onselect).toHaveBeenCalledWith(sugar);
    expect((input as HTMLInputElement).value).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes with Escape', async () => {
    const { input, user, onselect } = await setup();

    await user.type(input, 'sugar');
    await user.keyboard('{ArrowDown}{Escape}');

    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onselect).not.toHaveBeenCalled();
  });

  it('selects with a click', async () => {
    const { input, user, onselect } = await setup();

    await user.type(input, 'tomato');
    await user.click(
      screen.getByRole('option', { name: optionText('Tomato', 'each', t('shopSections.produce')) })
    );

    expect(onselect).toHaveBeenCalledWith(tomato);
  });

  it('suggests common ingredients that aren’t in the catalogue, marked Add to catalogue', async () => {
    const { input, user } = await setup();

    await user.type(input, 'sugar');

    const group = within(listbox()).getByRole('group', { name: t('picker.suggestions') });
    const suggested = within(group).getAllByRole('option');
    // Sugar · g is already in the catalogue; only Sugar · kg is offered.
    expect(suggested).toHaveLength(1);
    expect(suggested[0]?.textContent).toContain(
      optionText('Sugar', 'kg', t('shopSections.pantry'))
    );
    expect(suggested[0]?.textContent).toContain(t('picker.addToCatalogue'));
  });

  it('adds a suggestion to the catalogue, then selects it', async () => {
    const { input, user, onselect, reply, writes, store } = await setup();
    reply('PUT', stored);

    await user.type(input, 'basil');
    await user.click(screen.getByRole('option', { name: /Basil · bunch/ }));

    expect(writes()).toHaveLength(1);
    const [put] = writes();
    expect(put?.path).toMatch(/^\/catalogue\/ingredients\//);
    expect(put?.path.split('/').at(-1)).toMatch(uuidV7);
    expect(put?.body).toEqual({
      name: 'Basil',
      unit: 'bunch',
      shopSection: 'produce',
      deleted: false,
      version: 0
    });
    const basil = store.ingredients.find((item) => item.name === 'Basil');
    expect(basil?.version).toBe(1);
    expect(onselect).toHaveBeenCalledWith(basil);
  });

  it('creates a new ingredient from the Create option, with Enter', async () => {
    const { input, user, onselect, reply, writes } = await setup();
    reply('PUT', stored);

    await user.type(input, 'Zaatar');
    const create = screen.getByRole('option', { name: t('picker.create', { query: 'Zaatar' }) });
    expect(options().at(-1)).toBe(create);
    await user.keyboard('{ArrowUp}{Enter}');

    const name = screen.getByLabelText(t('ingredientForm.name'));
    expect((name as HTMLInputElement).value).toBe('Zaatar');
    const unit = screen.getByLabelText(t('ingredientForm.unit'));
    expect(document.activeElement).toBe(unit);
    await user.selectOptions(
      screen.getByLabelText(t('ingredientForm.shopSection')),
      t('shopSections.pantry')
    );
    await user.type(unit, 'g{Enter}');

    expect(writes().map((w) => w.body)).toEqual([
      { name: 'Zaatar', unit: 'g', shopSection: 'pantry', deleted: false, version: 0 }
    ]);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zaatar', unit: 'g' }));
    expect(screen.queryByLabelText(t('ingredientForm.unit'))).toBeNull();
  });

  it('suggests units already used for the name', async () => {
    const { input, user } = await setup([ingredient('Milk', 'carton')]);

    await user.type(input, 'Milk');
    await user.click(screen.getByRole('option', { name: t('picker.create', { query: 'Milk' }) }));

    const unit = screen.getByLabelText(t('ingredientForm.unit'));
    const list = document.getElementById(unit.getAttribute('list') ?? '');
    const units = [...(list?.querySelectorAll('option') ?? [])].map((o) => o.value);
    expect(units[0]).toBe('carton');
    expect(units).toContain('g');
  });

  it('cancels the create form, back to the input', async () => {
    const { input, user, writes } = await setup();

    await user.type(input, 'Zaatar');
    await user.click(screen.getByRole('option', { name: t('picker.create', { query: 'Zaatar' }) }));
    await user.click(screen.getByRole('button', { name: t('ingredientForm.cancel') }));

    expect(screen.queryByLabelText(t('ingredientForm.unit'))).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(writes()).toHaveLength(0);
  });

  it('warns about a duplicate name + unit, and can use the existing one', async () => {
    const { input, user, onselect, writes } = await setup();

    await user.type(input, 'Sugar');
    await user.click(screen.getByRole('option', { name: t('picker.create', { query: 'Sugar' }) }));
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'G{Enter}');

    expect(screen.getByRole('alert').textContent).toContain(
      t('ingredientForm.duplicate', { name: 'Sugar', unit: 'g' })
    );
    expect(writes()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: t('ingredientForm.useExisting') }));

    expect(onselect).toHaveBeenCalledWith(sugar);
    expect(writes()).toHaveLength(0);
  });

  it('can create a duplicate anyway', async () => {
    const { input, user, onselect, reply, writes } = await setup();
    reply('PUT', stored);

    await user.type(input, 'Sugar');
    await user.click(screen.getByRole('option', { name: t('picker.create', { query: 'Sugar' }) }));
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'g{Enter}');
    await user.click(screen.getByRole('button', { name: t('ingredientForm.createAnyway') }));

    expect(writes()).toHaveLength(1);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sugar', unit: 'g' }));
    expect(onselect.mock.calls[0]?.[0]?.id).not.toBe(sugar.id);
  });

  it('offers to show a hidden duplicate again and use it', async () => {
    const { input, user, onselect, reply, writes } = await setup();
    reply('PUT', stored);

    await user.type(input, 'Old spice');
    await user.click(
      screen.getByRole('option', { name: t('picker.create', { query: 'Old spice' }) })
    );
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'jar{Enter}');

    expect(screen.getByRole('alert').textContent).toContain(
      t('ingredientForm.duplicateHidden', { name: 'Old spice', unit: 'jar' })
    );
    await user.click(screen.getByRole('button', { name: t('ingredientForm.showAndUse') }));

    expect(writes().map((w) => [w.method, w.path])).toEqual([
      ['PUT', `/catalogue/ingredients/${oldSpice.id}`]
    ]);
    expect(writes()[0]?.body).toMatchObject({ deleted: false, version: 1 });
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: oldSpice.id }));
  });

  async function showHiddenDuplicate(env: Awaited<ReturnType<typeof setup>>) {
    const { input, user } = env;
    await user.type(input, 'Old spice');
    await user.click(
      screen.getByRole('option', { name: t('picker.create', { query: 'Old spice' }) })
    );
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'jar{Enter}');
    await user.click(screen.getByRole('button', { name: t('ingredientForm.showAndUse') }));
  }

  it('keeps the form open when showing the hidden duplicate fails', async () => {
    const env = await setup();
    env.reply('PUT', apiError(400, 'invalid', 'Nope'));

    await showHiddenDuplicate(env);

    expect(env.onselect).not.toHaveBeenCalled();
    expect(env.toasts.items).toHaveLength(1);
    expect(screen.getByRole('form', { name: t('picker.newIngredient') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('ingredientForm.showAndUse') })).toBeTruthy();
    expect(env.store.ingredients.find((item) => item.id === oldSpice.id)?.deleted).toBe(true);
  });

  it('keeps the form open when showing the hidden duplicate conflicts', async () => {
    const env = await setup();
    // Someone else edited it, and it's still hidden.
    const current = { ...oldSpice, shopSection: 'pantry' as const, version: 2 };
    env.reply('PUT', apiError(409, 'version-conflict', 'conflict', current));

    await showHiddenDuplicate(env);

    expect(env.onselect).not.toHaveBeenCalled();
    expect(env.toasts.items[0]?.message).toBe(t('mutate.conflict', { item: 'Old spice' }));
    expect(screen.getByRole('form', { name: t('picker.newIngredient') })).toBeTruthy();
  });

  it('marks Show it again busy while the show is pending', async () => {
    const env = await setup();
    let answer: (response: Response) => void = () => undefined;
    env.reply('PUT', new Promise<Response>((resolve) => (answer = resolve)));

    await showHiddenDuplicate(env);
    const showAndUse = screen.getByRole('button', { name: t('ingredientForm.showAndUse') });
    expect(showAndUse.getAttribute('aria-disabled')).toBe('true');
    await env.user.click(showAndUse);
    expect(env.writes()).toHaveLength(1);

    answer(json(200, { ...oldSpice, deleted: false, version: 2 }));
    await vi.waitFor(() =>
      expect(env.onselect).toHaveBeenCalledWith(expect.objectContaining({ id: oldSpice.id }))
    );
  });

  it('checks the create form', async () => {
    const { input, user, writes } = await setup();

    await user.type(input, 'Zaatar');
    await user.click(screen.getByRole('option', { name: t('picker.create', { query: 'Zaatar' }) }));
    await user.keyboard('{Enter}');

    const unit = screen.getByLabelText(t('ingredientForm.unit'));
    expect(unit.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(unit.getAttribute('aria-describedby') ?? '');
    expect(error?.textContent).toBe(t('ingredientForm.errors.unitRequired'));
    expect(writes()).toHaveLength(0);
  });
});
