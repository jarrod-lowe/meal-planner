import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
import IngredientList from './IngredientList.svelte';

const sugar = ingredient('Sugar', 'g', { shopSection: 'pantry' });
const milk = ingredient('Milk', 'l', { shopSection: 'dairy' });
const tomato = ingredient('Tomato', 'each', { shopSection: 'produce' });
const oldSpice = ingredient('Old spice', 'jar', { shopSection: 'pantry', deleted: true });
const common: CommonIngredient[] = [{ name: 'Basil', unit: 'bunch', shopSection: 'produce' }];
const noContent = () => new Response(null, { status: 204 });

async function setup(ingredients: Ingredient[] = [sugar, milk, tomato, oldSpice]) {
  const env = await loadedCatalogue({ ingredients });
  render(IngredientList, { store: env.store, common });
  return { ...env, user: userEvent.setup() };
}

const row = (name: string, unit: string) =>
  screen.getByText(t('ingredients.row', { name, unit })).closest('li') as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name });
const showHidden = () => screen.getByRole('checkbox', { name: t('ingredients.showHidden') });

describe('IngredientList', () => {
  it('groups ingredients by shop section, in shopping order, leaving out hidden ones', async () => {
    await setup();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      t('shopSections.produce'),
      t('shopSections.dairy'),
      t('shopSections.pantry')
    ]);
    const pantry = screen.getByRole('list', { name: t('shopSections.pantry') });
    expect(
      within(pantry).getByText(t('ingredients.row', { name: 'Sugar', unit: 'g' }))
    ).toBeTruthy();
    expect(screen.queryByText(t('ingredients.row', { name: 'Old spice', unit: 'jar' }))).toBeNull();
  });

  it('searches by name', async () => {
    const { user } = await setup();

    await user.type(screen.getByRole('searchbox', { name: t('ingredients.search') }), 'tomatoe');

    expect(screen.getByText(t('ingredients.row', { name: 'Tomato', unit: 'each' }))).toBeTruthy();
    expect(screen.queryByText(t('ingredients.row', { name: 'Sugar', unit: 'g' }))).toBeNull();
  });

  it('says when nothing matches', async () => {
    const { user } = await setup();

    await user.type(screen.getByRole('searchbox', { name: t('ingredients.search') }), 'qqqq');

    expect(screen.getByText(t('ingredients.noMatches', { query: 'qqqq' }))).toBeTruthy();
  });

  it('says when the catalogue is empty', async () => {
    await setup([]);

    expect(screen.getByText(t('ingredients.empty'))).toBeTruthy();
  });

  it('edits inline, saving with Enter and the version it read', async () => {
    const { user, reply, writes } = await setup();
    reply(`PUT /catalogue/ingredients/${sugar.id}`, stored);

    await user.click(button(t('ingredients.editLabel', { name: 'Sugar', unit: 'g' })));
    const form = screen.getByRole('form', { name: t('ingredients.editForm', { name: 'Sugar' }) });
    const name = within(form).getByLabelText(t('ingredientForm.name'));
    expect(document.activeElement).toBe(name);
    await user.clear(name);
    await user.type(name, 'Caster sugar');
    await user.selectOptions(
      within(form).getByLabelText(t('ingredientForm.shopSection')),
      t('shopSections.bakery')
    );
    await user.type(within(form).getByLabelText(t('ingredientForm.unit')), '{Enter}');

    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: `/catalogue/ingredients/${sugar.id}`,
        body: { name: 'Caster sugar', unit: 'g', shopSection: 'bakery', deleted: false, version: 1 }
      }
    ]);
    expect(screen.queryByRole('form')).toBeNull();
    const bakery = screen.getByRole('list', { name: t('shopSections.bakery') });
    expect(
      within(bakery).getByText(t('ingredients.row', { name: 'Caster sugar', unit: 'g' }))
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      button(t('ingredients.editLabel', { name: 'Caster sugar', unit: 'g' }))
    );
  });

  it('sends the version the edit form read, so a stale edit conflicts', async () => {
    const { store, user, reply, writes, toasts } = await setup();
    await user.click(button(t('ingredients.editLabel', { name: 'Sugar', unit: 'g' })));
    const form = screen.getByRole('form', { name: t('ingredients.editForm', { name: 'Sugar' }) });

    // Someone else changes the unit while the form is open.
    const theirs = { ...sugar, unit: 'kg', version: 2 };
    reply('GET /catalogue', json(200, { recipes: [], ingredients: [theirs, milk] }));
    await store.refresh();
    reply(
      `PUT /catalogue/ingredients/${sugar.id}`,
      apiError(409, 'version-conflict', 'conflict', theirs)
    );
    const name = within(form).getByLabelText(t('ingredientForm.name'));
    await user.clear(name);
    await user.type(name, 'Caster sugar{Enter}');

    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: `/catalogue/ingredients/${sugar.id}`,
        body: { name: 'Caster sugar', unit: 'g', shopSection: 'pantry', deleted: false, version: 1 }
      }
    ]);
    expect(toasts.items[0]?.message).toBe(t('mutate.conflict', { item: 'Caster sugar' }));
    expect(store.ingredients[0]).toEqual(theirs);
  });

  it('cancels an edit with Escape, sending nothing', async () => {
    const { user, writes } = await setup();

    await user.click(button(t('ingredients.editLabel', { name: 'Sugar', unit: 'g' })));
    await user.type(screen.getByLabelText(t('ingredientForm.name')), 'xx{Escape}');

    expect(screen.queryByRole('form')).toBeNull();
    expect(writes()).toHaveLength(0);
    expect(document.activeElement).toBe(
      button(t('ingredients.editLabel', { name: 'Sugar', unit: 'g' }))
    );
  });

  it('sends nothing when an edit changes nothing', async () => {
    const { user, writes } = await setup();

    await user.click(button(t('ingredients.editLabel', { name: 'Sugar', unit: 'g' })));
    await user.keyboard('{Enter}');

    expect(writes()).toHaveLength(0);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('hides an ingredient', async () => {
    const { user, reply, writes } = await setup();
    reply(`DELETE /catalogue/ingredients/${sugar.id}`, noContent());
    reply(
      'GET /catalogue',
      json(200, { recipes: [], ingredients: [{ ...sugar, deleted: true, version: 2 }, milk] })
    );

    await user.click(button(t('ingredients.hideLabel', { name: 'Sugar', unit: 'g' })));

    expect(writes()).toEqual([
      { method: 'DELETE', path: `/catalogue/ingredients/${sugar.id}`, body: undefined }
    ]);
    expect(screen.queryByText(t('ingredients.row', { name: 'Sugar', unit: 'g' }))).toBeNull();
  });

  it('shows hidden ones, marked hidden, and shows one again', async () => {
    const { user, reply, writes } = await setup();
    reply(`PUT /catalogue/ingredients/${oldSpice.id}`, stored);

    await user.click(showHidden());
    const spice = row('Old spice', 'jar');
    expect(within(spice).getByText(t('ingredients.hidden'))).toBeTruthy();
    expect(within(spice).queryByRole('button', { name: /^Hide/ })).toBeNull();

    await user.click(button(t('ingredients.showAgainLabel', { name: 'Old spice', unit: 'jar' })));

    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: `/catalogue/ingredients/${oldSpice.id}`,
        body: { name: 'Old spice', unit: 'jar', shopSection: 'pantry', deleted: false, version: 1 }
      }
    ]);
    expect(within(row('Old spice', 'jar')).queryByText(t('ingredients.hidden'))).toBeNull();
    expect(document.activeElement).toBe(
      button(t('ingredients.hideLabel', { name: 'Old spice', unit: 'jar' }))
    );
  });

  it('adds an ingredient with a new UUIDv7', async () => {
    const { user, reply, writes } = await setup();
    reply('PUT', stored);

    await user.click(button(t('ingredients.add')));
    const form = screen.getByRole('form', { name: t('ingredients.addForm') });
    await user.type(within(form).getByLabelText(t('ingredientForm.name')), 'Flour');
    await user.type(within(form).getByLabelText(t('ingredientForm.unit')), 'kg');
    await user.selectOptions(
      within(form).getByLabelText(t('ingredientForm.shopSection')),
      t('shopSections.pantry')
    );
    await user.click(within(form).getByRole('button', { name: t('ingredientForm.save') }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.path.split('/').at(-1)).toMatch(uuidV7);
    expect(writes()[0]?.body).toEqual({
      name: 'Flour',
      unit: 'kg',
      shopSection: 'pantry',
      deleted: false,
      version: 0
    });
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText(t('ingredients.row', { name: 'Flour', unit: 'kg' }))).toBeTruthy();
  });

  it('warns before adding a duplicate, and can keep the existing one', async () => {
    const { user, writes } = await setup();

    await user.click(button(t('ingredients.add')));
    await user.type(screen.getByLabelText(t('ingredientForm.name')), 'sugar');
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'g{Enter}');

    expect(screen.getByRole('alert').textContent).toContain(
      t('ingredientForm.duplicate', { name: 'Sugar', unit: 'g' })
    );
    await user.click(button(t('ingredientForm.keepExisting')));

    expect(writes()).toHaveLength(0);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('warns before adding a hidden duplicate, and can show it again', async () => {
    const { user, reply, writes } = await setup();
    reply(`PUT /catalogue/ingredients/${oldSpice.id}`, stored);

    await user.click(button(t('ingredients.add')));
    await user.type(screen.getByLabelText(t('ingredientForm.name')), 'Old spice');
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'jar{Enter}');
    await user.click(button(t('ingredientForm.showExisting')));

    expect(writes()[0]?.body).toMatchObject({ deleted: false });
    expect(screen.getByText(t('ingredients.row', { name: 'Old spice', unit: 'jar' }))).toBeTruthy();
  });

  it('keeps the add form open when showing the hidden duplicate fails', async () => {
    const { user, reply, toasts } = await setup();
    reply(`PUT /catalogue/ingredients/${oldSpice.id}`, apiError(400, 'invalid', 'Nope'));

    await user.click(button(t('ingredients.add')));
    await user.type(screen.getByLabelText(t('ingredientForm.name')), 'Old spice');
    await user.type(screen.getByLabelText(t('ingredientForm.unit')), 'jar{Enter}');
    await user.click(button(t('ingredientForm.showExisting')));

    expect(toasts.items).toHaveLength(1);
    expect(screen.getByRole('form', { name: t('ingredients.addForm') })).toBeTruthy();
    expect(screen.queryByText(t('ingredients.row', { name: 'Old spice', unit: 'jar' }))).toBeNull();
  });

  it('adds a common ingredient that matches the search', async () => {
    const { user, reply, writes } = await setup();
    reply('PUT', stored);

    await user.type(screen.getByRole('searchbox', { name: t('ingredients.search') }), 'basil');
    await user.click(
      button(
        t('ingredients.addSuggestionLabel', {
          name: 'Basil',
          unit: 'bunch',
          section: t('shopSections.produce')
        })
      )
    );

    expect(writes()[0]?.body).toEqual({
      name: 'Basil',
      unit: 'bunch',
      shopSection: 'produce',
      deleted: false,
      version: 0
    });
    const produce = screen.getByRole('list', { name: t('shopSections.produce') });
    expect(
      within(produce).getByText(t('ingredients.row', { name: 'Basil', unit: 'bunch' }))
    ).toBeTruthy();
  });
});
