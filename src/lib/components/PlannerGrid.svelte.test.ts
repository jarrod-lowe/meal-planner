import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { recipe } from '#lib/test/catalogue.js';
import { facts, holidayId, meta } from '#lib/test/holiday.js';
import PlannerGrid from './PlannerGrid.svelte';

const ann = { id: '0190a0b0-0000-7000-8000-0000000000a1', name: 'Ann', version: 1, ...meta };
const bob = { id: '0190a0b0-0000-7000-8000-0000000000a2', name: 'Bob', version: 1, ...meta };
const gone = '0190a0b0-0000-7000-8000-0000000000a9';
const bolognese = recipe('Bolognese');

const meal = (
  id: string,
  name: string,
  slot: Schemas['MealSlot'],
  at: string,
  overrides: Partial<Schemas['Meal']> = {}
): Schemas['Meal'] => ({
  id: `0190a0b0-0000-7000-8000-0000000000${id}`,
  name,
  slot,
  recipeId: null,
  mealtimes: [{ id: `0190a0b0-0000-7000-8000-0000000001${id}`, at, attendeeIds: [ann.id] }],
  version: 1,
  ...meta,
  ...overrides
});

const dinnerA = meal('c1', 'Dinner A', 'dinner', '2027-01-01T18:30', {
  recipeId: bolognese.id,
  mealtimes: [
    {
      id: '0190a0b0-0000-7000-8000-0000000001c1',
      at: '2027-01-01T18:30',
      attendeeIds: [ann.id, bob.id, gone]
    }
  ]
});
const dinnerB = meal('c2', 'Dinner B', 'dinner', '2027-01-01T18:45');
const early = meal('c3', 'Early lunch', 'lunch', '2026-12-30T12:30');

function setup(meals: Schemas['Meal'][] = [dinnerB, dinnerA]) {
  const input = facts({
    holiday: { ...facts().holiday, startDate: '2026-12-31', endDate: '2027-01-02' },
    attendees: [ann, bob],
    meals
  });
  render(PlannerGrid, { holidayId, facts: input, recipes: [bolognese] });
  return { user: userEvent.setup() };
}

const table = () => screen.getByRole('table', { name: t('plan.caption') });
const phone = () => screen.getByTestId('planner-days');
const editor = (id: string) => `/holidays/${holidayId}/meals/${id}`;

describe('PlannerGrid', () => {
  it('has a row per day and a column per meal slot, with headers', () => {
    setup([]);

    const columns = within(table()).getAllByRole('columnheader');
    expect(columns.map((th) => th.textContent?.trim())).toEqual([
      t('plan.day'),
      t('slots.breakfast'),
      t('slots.lunch'),
      t('slots.dinner'),
      t('slots.snacks'),
      t('slots.other')
    ]);
    expect(columns.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    const rows = within(table()).getAllByRole('rowheader');
    expect(rows.map((th) => th.textContent?.trim())).toEqual([
      'Thu 31 Dec',
      'Fri 1 Jan',
      'Sat 2 Jan'
    ]);
    expect(rows.every((th) => th.getAttribute('scope') === 'row')).toBe(true);
  });

  it('shows each meal as a chip with its name, recipe and servings, linking to the editor', () => {
    setup();

    const chip = within(table()).getByRole('link', { name: /Dinner A/ });
    expect(chip.textContent).toContain('Bolognese');
    // The deleted attendee isn't counted.
    expect(chip.textContent).toContain(t('plan.servings', { count: 2 }));
    expect(chip.getAttribute('href')).toBe(editor(dinnerA.id));
  });

  it('says No recipe yet for a meal without one', () => {
    setup();

    const chip = within(table()).getByRole('link', { name: /Dinner B/ });
    expect(chip.textContent).toContain(t('plan.noRecipe'));
    expect(chip.textContent).toContain(t('plan.servings', { count: 1 }));
  });

  it('puts parallel meals side by side in one cell, by time, with a link to add another', () => {
    setup();

    const cell = within(table())
      .getByRole('link', { name: /Dinner A/ })
      .closest('td');
    const links = within(cell as HTMLElement).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      editor(dinnerA.id),
      editor(dinnerB.id),
      `${editor('new')}?date=2027-01-01&slot=dinner`
    ]);
    expect(links.at(-1)?.getAttribute('aria-label')).toBe(
      t('plan.addAnotherLabel', { slot: t('slots.dinner'), date: 'Fri 1 Jan' })
    );
  });

  it('offers a + on each empty cell, prefilled with its date and slot', () => {
    setup();

    const add = within(table()).getByRole('link', {
      name: t('plan.addLabel', { slot: t('slots.breakfast'), date: 'Thu 31 Dec' })
    });
    expect(add.textContent?.trim()).toBe(t('plan.add'));
    expect(add.getAttribute('href')).toBe(`${editor('new')}?date=2026-12-31&slot=breakfast`);
    // 15 cells: 14 empty ones with a +, and the dinner with its add another.
    const adds = within(table()).getAllByRole('link', { name: /^Add / });
    expect(adds.filter((a) => a.textContent?.trim() === t('plan.add'))).toHaveLength(14);
  });

  it('lists meals outside the holiday dates below the grid', () => {
    setup([dinnerA, early]);

    const outside = screen.getByRole('region', { name: t('plan.outside.heading') });
    const link = within(outside).getByRole('link');
    expect(link.textContent).toBe(
      t('plan.outside.meal', { name: 'Early lunch', date: '30 Dec 2026' })
    );
    expect(link.getAttribute('href')).toBe(editor(early.id));
  });

  it('has no outside list when every meal is inside the dates', () => {
    setup();

    expect(screen.queryByRole('region', { name: t('plan.outside.heading') })).toBeNull();
  });

  it('has a phone layout: a list of days, each with its slots and the same cells', () => {
    setup();

    const days = within(phone()).getAllByRole('listitem', { name: /./ });
    expect(days.map((day) => within(day).getAllByRole('heading')[0]?.textContent?.trim())).toEqual([
      'Thu 31 Dec',
      'Fri 1 Jan',
      'Sat 2 Jan'
    ]);
    const friday = days[1] as HTMLElement;
    const headings = within(friday).getAllByRole('heading');
    expect(headings.map((h) => h.textContent?.trim())).toEqual([
      'Fri 1 Jan',
      t('slots.breakfast'),
      t('slots.lunch'),
      t('slots.dinner'),
      t('slots.snacks'),
      t('slots.other')
    ]);
    expect(
      within(friday)
        .getByRole('link', { name: /Dinner A/ })
        .getAttribute('href')
    ).toBe(editor(dinnerA.id));
  });

  it('moves between cells with the arrow keys', async () => {
    const { user } = setup();

    const chip = within(table()).getByRole('link', { name: /Dinner A/ });
    chip.focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('href')).toBe(
      `${editor('new')}?date=2027-01-01&slot=lunch`
    );
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('href')).toBe(
      `${editor('new')}?date=2027-01-02&slot=lunch`
    );
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowRight}');
    expect(document.activeElement?.getAttribute('href')).toBe(
      `${editor('new')}?date=2026-12-31&slot=dinner`
    );
  });
});
