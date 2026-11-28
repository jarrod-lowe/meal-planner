import '#lib/test/dialog.js';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { ingredient, loadedCatalogue, recipe, stored, uuidV7 } from '#lib/test/catalogue.js';
import { apiError, facts, holidayId, loadedHoliday, meta } from '#lib/test/holiday.js';
import { MealDrafts, mealDraftKey } from '#lib/stores/meal-drafts.js';
import MealEditor from './MealEditor.svelte';

const people = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'].map((name, n) => ({
  id: `0190a0b0-0000-7000-8000-0000000000a${n}`,
  name,
  version: 1,
  ...meta
}));
const everyone = people.map((person) => person.id);
const mince = ingredient('Mince', 'g', { shopSection: 'meat-fish' });
const onion = ingredient('Onion', 'each', { shopSection: 'produce' });
const bolognese = recipe('Bolognese', {
  servings: 4,
  lines: [
    { ingredientId: mince.id, quantity: 500 },
    { ingredientId: onion.id, quantity: 1 }
  ]
});
const curry = recipe('Curry', { servings: 2 });

const mealId = '0190a0b0-0000-7000-8000-0000000000c1';
const mealtimeId = '0190a0b0-0000-7000-8000-0000000000d1';
const saved = (overrides: Partial<Schemas['Meal']> = {}): Schemas['Meal'] => ({
  id: mealId,
  name: 'Feast',
  slot: 'lunch',
  recipeId: bolognese.id,
  mealtimes: [{ id: mealtimeId, at: '2026-12-27T13:00', attendeeIds: everyone.slice(0, 2) }],
  version: 3,
  ...meta,
  ...overrides
});

interface Options {
  mealId?: string;
  date?: string | null;
  slot?: string | null;
  meals?: Schemas['Meal'][];
  drafts?: MealDrafts;
  recipe?: string | null;
  oncreaterecipe?: (query: string) => void;
}

async function setup(options: Options = {}) {
  const holiday = await loadedHoliday(facts({ attendees: people, meals: options.meals ?? [] }));
  const catalogue = await loadedCatalogue({
    recipes: [bolognese, curry],
    ingredients: [mince, onion]
  });
  const oncreated = vi.fn();
  const ondeleted = vi.fn();
  const drafts = options.drafts ?? new MealDrafts();
  const mount = (more: Pick<Options, 'recipe' | 'oncreaterecipe'> = options) =>
    render(MealEditor, {
      store: holiday.store,
      catalogue: catalogue.store,
      drafts,
      now: { current: '2026-12-26T09:00' },
      mealId: options.mealId ?? 'new',
      date: options.date ?? null,
      slot: options.slot ?? null,
      recipe: more.recipe ?? null,
      oncreated,
      ondeleted,
      oncreaterecipe: more.oncreaterecipe
    });
  let view = mount();
  const writes = () => holiday.requests.filter((r) => r.method !== 'GET');
  /** Leaves the editor and comes back to it, as a trip to the recipe editor does. */
  const remount = (more: Pick<Options, 'recipe' | 'oncreaterecipe'> = {}) => {
    view.unmount();
    view = mount(more);
  };
  return {
    ...holiday,
    catalogue: catalogue.store,
    drafts,
    oncreated,
    ondeleted,
    writes,
    remount,
    user: userEvent.setup()
  };
}

const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const nameField = () => field(t('meal.name'));
const slotField = () => screen.getByLabelText<HTMLSelectElement>(t('meal.slot'));
const dateField = () => field(t('meal.date'));
const timeField = () => field(t('meal.time'));
const button = (name: string) => screen.getByRole('button', { name });
const checked = () =>
  within(screen.getByRole('group', { name: t('meal.eating') }))
    .getAllByRole<HTMLInputElement>('checkbox')
    .filter((box) => box.checked)
    .map((box) => box.labels?.[0]?.textContent?.trim());
const preview = () => screen.getByRole('region', { name: t('meal.preview.heading') });
const setDate = (value: string) => fireEvent.input(dateField(), { target: { value } });

async function chooseRecipe(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(screen.getByRole('combobox', { name: t('meal.findRecipe') }));
  await user.keyboard(`${query}{ArrowDown}{Enter}`);
}

describe('MealEditor', () => {
  it('starts from the query’s date and slot, with the slot’s time, everyone and no recipe', async () => {
    await setup({ date: '2027-01-01', slot: 'breakfast' });

    expect(nameField().value).toBe('1 Jan Breakfast');
    expect(slotField().value).toBe('breakfast');
    expect(dateField().value).toBe('2027-01-01');
    expect(timeField().value).toBe('08:00');
    expect(checked()).toEqual(['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay']);
    expect(screen.getByText(t('meal.noRecipe'))).toBeTruthy();
  });

  it('defaults to the holiday’s first day and dinner, ignoring a bad query', async () => {
    await setup({ date: '2027-02-30', slot: 'brunch' });

    expect(dateField().value).toBe('2026-12-26');
    expect(slotField().value).toBe('dinner');
    expect(timeField().value).toBe('18:30');
    expect(nameField().value).toBe('26 Dec Dinner');
  });

  it('suggests the name from the date and slot until the name is edited', async () => {
    const { user } = await setup({ date: '2027-01-01', slot: 'dinner' });

    await user.selectOptions(slotField(), 'lunch');
    expect(nameField().value).toBe('1 Jan Lunch');
    await setDate('2027-01-02');
    expect(nameField().value).toBe('2 Jan Lunch');

    await user.clear(nameField());
    await user.type(nameField(), 'Picnic');
    await user.selectOptions(slotField(), 'snacks');
    await setDate('2027-01-01');
    expect(nameField().value).toBe('Picnic');
  });

  it('follows the slot’s default time until the time is edited', async () => {
    const { user } = await setup({ date: '2027-01-01', slot: 'dinner' });

    await user.selectOptions(slotField(), 'lunch');
    expect(timeField().value).toBe('12:30');

    await fireEvent.input(timeField(), { target: { value: '11:45' } });
    await user.selectOptions(slotField(), 'breakfast');
    expect(timeField().value).toBe('11:45');
  });

  it('ticks no one and everyone', async () => {
    const { user } = await setup();

    await user.click(button(t('meal.noOne')));
    expect(checked()).toEqual([]);
    await user.click(screen.getByLabelText('Cat'));
    expect(checked()).toEqual(['Cat']);
    await user.click(button(t('meal.everyone')));
    expect(checked()).toEqual(['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay']);
  });

  it('previews the recipe scaled to the people eating, as they’re ticked', async () => {
    const { user } = await setup();
    expect(within(preview()).getByText(t('meal.preview.noRecipe'))).toBeTruthy();

    await chooseRecipe(user, 'bolog');

    expect(within(preview()).getByText('Serves 6 (recipe for 4, ×1.5)')).toBeTruthy();
    const rows = () =>
      within(preview())
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent?.trim())
        );
    expect(rows()).toEqual([
      ['Mince', '750', 'g'],
      ['Onion', '1.5', 'each']
    ]);

    await user.click(screen.getByLabelText('Fay'));
    await user.click(screen.getByLabelText('Eve'));
    expect(within(preview()).getByText('Serves 4 (recipe for 4, ×1)')).toBeTruthy();
    expect(rows()[0]).toEqual(['Mince', '500', 'g']);

    await user.click(screen.getByLabelText('Dan'));
    expect(within(preview()).getByText('Serves 3 (recipe for 4, ×0.75)')).toBeTruthy();
    expect(rows()[1]).toEqual(['Onion', '0.75', 'each']);

    await user.click(button(t('meal.noOne')));
    expect(within(preview()).getByText(t('meal.preview.noOne'))).toBeTruthy();
  });

  it('saves a new meal as one PUT, then hands over its id', async () => {
    const { user, reply, writes, oncreated } = await setup({ date: '2027-01-01', slot: 'dinner' });
    reply('PUT', stored);
    await chooseRecipe(user, 'bolog');
    await user.click(screen.getByLabelText('Bob'));

    await user.click(button(t('meal.save')));

    expect(writes()).toHaveLength(1);
    const [put] = writes();
    const id = put?.path.split('/').at(-1) ?? '';
    expect(id).toMatch(uuidV7);
    expect(put?.path).toBe(`/holidays/${holidayId}/meals/${id}`);
    const body = put?.body as Schemas['MealInput'];
    expect(body).toEqual({
      name: '1 Jan Dinner',
      slot: 'dinner',
      recipeId: bolognese.id,
      mealtimes: [
        {
          id: body.mealtimes[0]?.id,
          at: '2027-01-01T18:30',
          attendeeIds: everyone.filter((person) => person !== everyone[1])
        }
      ],
      version: 0
    });
    expect(body.mealtimes[0]?.id).toMatch(uuidV7);
    expect(oncreated).toHaveBeenCalledWith(id);
  });

  it('checks the name, date and time before saving', async () => {
    const { user, writes } = await setup();

    await user.clear(nameField());
    await setDate('');
    await fireEvent.input(timeField(), { target: { value: '' } });
    await user.click(button(t('meal.save')));

    expect(writes()).toEqual([]);
    expect(screen.getByText(t('meal.errors.nameRequired'))).toBeTruthy();
    expect(screen.getByText(t('meal.errors.dateRequired'))).toBeTruthy();
    expect(screen.getByText(t('meal.errors.timeRequired'))).toBeTruthy();
    expect(document.activeElement).toBe(nameField());
  });

  it('edits a saved meal, keeping its mealtime’s id, and saves at its version', async () => {
    const { user, reply, writes } = await setup({ mealId, meals: [saved()] });
    reply('PUT', stored);

    expect(nameField().value).toBe('Feast');
    expect(slotField().value).toBe('lunch');
    expect(dateField().value).toBe('2026-12-27');
    expect(timeField().value).toBe('13:00');
    expect(checked()).toEqual(['Ann', 'Bob']);
    expect(screen.getByText('Bolognese')).toBeTruthy();

    // A name of its own stays put when the slot changes.
    await user.selectOptions(slotField(), 'dinner');
    expect(nameField().value).toBe('Feast');
    // So does a time of its own.
    expect(timeField().value).toBe('13:00');
    await user.click(button(t('meal.save')));

    expect(writes()[0]?.body).toEqual({
      name: 'Feast',
      slot: 'dinner',
      recipeId: bolognese.id,
      mealtimes: [{ id: mealtimeId, at: '2026-12-27T13:00', attendeeIds: everyone.slice(0, 2) }],
      version: 3
    });
    expect(await screen.findByText(t('meal.saved'))).toBeTruthy();
  });

  it('changes and removes the recipe', async () => {
    const { user, reply, writes } = await setup({ mealId, meals: [saved()] });
    reply('PUT', stored, stored);

    await user.click(button(t('meal.changeLabel')));
    await chooseRecipe(user, 'curry');
    expect(screen.getByText('Curry')).toBeTruthy();
    expect(document.activeElement).toBe(button(t('meal.changeLabel')));

    await user.click(button(t('meal.removeLabel')));
    expect(screen.getByText(t('meal.noRecipe'))).toBeTruthy();
    await user.click(button(t('meal.save')));

    expect((writes()[0]?.body as Schemas['MealInput']).recipeId).toBeNull();
  });

  it('deletes the meal after a confirm, then goes back', async () => {
    const { user, reply, writes, ondeleted, store } = await setup({ mealId, meals: [saved()] });
    reply('DELETE', new Response(null, { status: 204 }));

    await user.click(button(t('meal.delete')));
    const dialog = screen.getByRole('dialog', { name: t('meal.deleteHeading', { name: 'Feast' }) });
    await user.click(within(dialog).getByRole('button', { name: t('meal.deleteConfirm') }));

    expect(ondeleted).toHaveBeenCalledOnce();
    expect(store.facts?.meals).toEqual([]);
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'DELETE',
      path: `/holidays/${holidayId}/meals/${mealId}`
    });
  });

  it('keeps a stale draft from overwriting someone else’s change, and loads the latest', async () => {
    const { user, reply, writes, store } = await setup({ mealId, meals: [saved()] });
    await user.clear(nameField());
    await user.type(nameField(), 'Mine');

    // Someone else's change arrives on a refresh.
    reply(
      `GET /holidays/${holidayId}`,
      new Response(
        JSON.stringify(
          facts({ attendees: people, meals: [saved({ name: 'Theirs', version: 4 })] })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await store.refresh();

    expect(await screen.findByText(t('meal.changedElsewhere'))).toBeTruthy();
    expect(nameField().value).toBe('Mine');
    reply('PUT', apiError(409, 'version-conflict', 'x', saved({ name: 'Theirs', version: 4 })));
    await user.click(button(t('meal.save')));
    expect(writes()[0]?.body).toMatchObject({ name: 'Mine', version: 3 });

    await user.click(await screen.findByRole('button', { name: t('meal.loadLatest') }));
    expect(nameField().value).toBe('Theirs');
    expect(screen.queryByText(t('meal.changedElsewhere'))).toBeNull();
  });

  it('takes someone else’s change at once when the draft is untouched', async () => {
    const { reply, store } = await setup({ mealId, meals: [saved()] });

    reply(
      `GET /holidays/${holidayId}`,
      new Response(
        JSON.stringify(
          facts({ attendees: people, meals: [saved({ name: 'Theirs', version: 4 })] })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await store.refresh();

    await vi.waitFor(() => expect(nameField().value).toBe('Theirs'));
    expect(screen.queryByText(t('meal.changedElsewhere'))).toBeNull();
  });

  it('locks Save and Delete while its write is in flight', async () => {
    const { user, reply, writes } = await setup({ mealId, meals: [saved()] });
    let answer: (response: Response) => void = () => undefined;
    reply('PUT', new Promise<Response>((resolve) => (answer = resolve)));

    await user.click(button(t('meal.save')));
    const saving = button(t('meal.saving'));
    expect(saving.getAttribute('aria-disabled')).toBe('true');
    expect(button(t('meal.delete')).getAttribute('aria-disabled')).toBe('true');
    await user.click(saving);
    await user.click(button(t('meal.delete')));
    expect(
      screen.queryByRole('dialog', { name: t('meal.deleteHeading', { name: 'Feast' }) })
    ).toBeNull();
    expect(writes()).toHaveLength(1);

    answer(
      new Response(JSON.stringify(saved({ version: 4 })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    expect(await screen.findByText(t('meal.saved'))).toBeTruthy();
  });

  it('says when the meal doesn’t exist', async () => {
    await setup({ mealId });

    expect(screen.getByRole('heading', { name: t('meal.notFound.heading') })).toBeTruthy();
    expect(screen.getByText(t('meal.notFound.message'))).toBeTruthy();
  });
});

describe('MealEditor, creating a recipe on the way', () => {
  const createOption = (query: string) =>
    screen.getByRole('option', { name: t('recipePicker.create', { query }) });

  async function createRecipe(user: ReturnType<typeof userEvent.setup>, query: string) {
    await user.click(screen.getByRole('combobox', { name: t('meal.findRecipe') }));
    await user.keyboard(query);
    await user.click(createOption(query));
  }

  it('keeps a new meal’s draft while a recipe is made, then uses the new recipe', async () => {
    const oncreaterecipe = vi.fn();
    const env = await setup({ date: '2027-01-01', slot: 'dinner', oncreaterecipe });
    const { user, drafts, reply, writes, oncreated } = env;
    const put = vi.spyOn(drafts, 'put');
    await user.clear(nameField());
    await user.type(nameField(), 'Party');
    await fireEvent.input(timeField(), { target: { value: '19:15' } });
    await user.click(screen.getByLabelText('Bob'));

    await createRecipe(user, 'Lasagne');

    expect(oncreaterecipe).toHaveBeenCalledWith('Lasagne');
    expect(put).toHaveBeenCalledOnce();
    const [key, stash] = put.mock.calls[0] ?? [];
    expect(key).toBe(mealDraftKey(holidayId, 'new', '2027-01-01', 'dinner'));

    // Back from the recipe editor, with the recipe it made.
    env.remount({ recipe: curry.id });

    expect(nameField().value).toBe('Party');
    expect(timeField().value).toBe('19:15');
    expect(checked()).toEqual(['Ann', 'Cat', 'Dan', 'Eve', 'Fay']);
    expect(screen.getByText('Curry')).toBeTruthy();
    // The name and time are still the user's own.
    await user.selectOptions(slotField(), 'lunch');
    expect(nameField().value).toBe('Party');
    expect(timeField().value).toBe('19:15');

    reply('PUT', stored);
    await user.click(button(t('meal.save')));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.path).toBe(`/holidays/${holidayId}/meals/${stash?.id}`);
    expect(writes()[0]?.body).toEqual({
      name: 'Party',
      slot: 'lunch',
      recipeId: curry.id,
      mealtimes: [
        {
          id: stash?.mealtimeId,
          at: '2027-01-01T19:15',
          attendeeIds: everyone.filter((person) => person !== everyone[1])
        }
      ],
      version: 0
    });
    expect(oncreated).toHaveBeenCalledWith(stash?.id);
    expect(drafts.take(key ?? '')).toBeUndefined();
  });

  it('keeps a saved meal’s draft and base version through the trip', async () => {
    const env = await setup({ mealId, meals: [saved()], oncreaterecipe: vi.fn() });
    const { user, reply, writes } = env;
    await user.clear(nameField());
    await user.type(nameField(), 'Mine');
    await user.click(button(t('meal.changeLabel')));

    await createRecipe(user, 'Pie');
    env.remount({ recipe: curry.id });

    expect(nameField().value).toBe('Mine');
    expect(screen.getByText('Curry')).toBeTruthy();
    reply('PUT', stored);
    await user.click(button(t('meal.save')));
    expect(writes()[0]?.body).toEqual({
      name: 'Mine',
      slot: 'lunch',
      recipeId: curry.id,
      mealtimes: [{ id: mealtimeId, at: '2026-12-27T13:00', attendeeIds: everyone.slice(0, 2) }],
      version: 3
    });
  });

  it('comes back with the draft intact when no recipe was made', async () => {
    const env = await setup({ date: '2027-01-01', slot: 'dinner', oncreaterecipe: vi.fn() });
    const { user } = env;
    await user.click(screen.getByLabelText('Ann'));
    await createRecipe(user, 'Stew');

    env.remount();

    expect(checked()).toEqual(['Bob', 'Cat', 'Dan', 'Eve', 'Fay']);
    expect(screen.getByText(t('meal.noRecipe'))).toBeTruthy();
  });

  it('starts afresh after coming back once', async () => {
    const env = await setup({ date: '2027-01-01', slot: 'dinner', oncreaterecipe: vi.fn() });
    const { user } = env;
    await user.click(screen.getByLabelText('Ann'));
    await createRecipe(user, 'Stew');
    env.remount();

    env.remount();

    expect(checked()).toEqual(['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay']);
  });

  it('uses a returned recipe on a meal with no stashed draft', async () => {
    await setup({ mealId, meals: [saved()], recipe: curry.id });

    expect(screen.getByText('Curry')).toBeTruthy();
  });

  it('ignores a returned recipe that isn’t in the catalogue', async () => {
    await setup({ mealId, meals: [saved()], recipe: '0190a0b0-0000-7000-8000-0000000000ff' });

    expect(screen.getByText('Bolognese')).toBeTruthy();
  });

  it('offers no Create new recipe without somewhere to make one', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('combobox', { name: t('meal.findRecipe') }));
    await user.keyboard('Stew');

    expect(
      screen.queryByRole('option', { name: t('recipePicker.create', { query: 'Stew' }) })
    ).toBeNull();
  });
});
