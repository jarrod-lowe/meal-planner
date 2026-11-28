import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import {
  en,
  expectNoAxeViolations,
  fakeUsers,
  greeting,
  heading,
  submitSignIn
} from './helpers.js';

const { normal } = fakeUsers;
const holidayId = '0190a0b0-0000-7000-8000-000000000001';
const minceId = '0190a0b0-0000-7000-8000-0000000000f1';
const onionId = '0190a0b0-0000-7000-8000-0000000000f2';
const bologneseId = '0190a0b0-0000-7000-8000-0000000000e1';
const people = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'].map((name, n) => ({
  id: `0190a0b0-0000-7000-8000-0000000000a${n}`,
  name
}));
const [ann, bob] = people as [(typeof people)[0], (typeof people)[0]];
const picnic = {
  id: '0190a0b0-0000-7000-8000-0000000000c1',
  name: 'Picnic',
  slot: 'lunch' as const,
  recipeId: null,
  mealtimes: [
    {
      id: '0190a0b0-0000-7000-8000-0000000000d1',
      at: '2026-12-26T12:30',
      attendeeIds: [ann.id, bob.id]
    }
  ]
};
const fill = (text: string, params: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

const recipeField = (page: Page) => page.getByRole('combobox', { name: en.meal.findRecipe });
const preview = (page: Page) => page.getByRole('region', { name: en.meal.preview.heading });

test.beforeEach(async ({ page, api }) => {
  // Before the holiday, so its meals are all still to come.
  await page.clock.setFixedTime(new Date('2026-12-01T09:00:00+13:00'));
  api.users = [{ sub: normal.sub, name: normal.name }];
  api.seed({
    holiday: {
      id: holidayId,
      name: 'Summer',
      timeZone: 'Pacific/Auckland',
      startDate: '2026-12-26',
      endDate: '2026-12-28'
    },
    attendees: people,
    meals: [picnic],
    members: [normal.sub]
  });
  api.seedCatalogue({
    ingredients: [
      { id: minceId, name: 'Mince', unit: 'g', shopSection: 'meat-fish', deleted: false },
      { id: onionId, name: 'Onion', unit: 'each', shopSection: 'produce', deleted: false }
    ],
    recipes: [
      {
        id: bologneseId,
        name: 'Bolognese',
        servings: 4,
        notes: '',
        deleted: false,
        lines: [
          { ingredientId: minceId, quantity: 500 },
          { ingredientId: onionId, quantity: 2 }
        ]
      }
    ]
  });
  await page.goto('/');
  await submitSignIn(page, normal.email, normal.password);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('plans a dinner for 6 from a recipe for 4, then Dinner B beside it', async ({ page, api }) => {
  await page.goto(`/holidays/${holidayId}/plan`);
  const where = { slot: en.slots.dinner, date: 'Sun 27 Dec' };
  await page.getByRole('link', { name: fill(en.plan.addLabel, where) }).click();
  await expect(heading(page, en.meal.newHeading)).toBeVisible();

  await recipeField(page).fill('bolog');
  await recipeField(page).press('ArrowDown');
  await recipeField(page).press('Enter');

  await expect(
    preview(page).getByText(
      fill(en.meal.preview.serves, { servings: 6, recipeServings: 4, factor: 1.5 })
    )
  ).toBeVisible();
  await expect(preview(page).getByRole('row', { name: 'Mince 750 g' })).toBeVisible();
  await expect(preview(page).getByRole('row', { name: 'Onion 3 each' })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: en.meal.save }).click();
  await expect(heading(page, '27 Dec Dinner')).toBeVisible();
  await page.getByRole('link', { name: en.meal.back }).click();

  await page.getByRole('link', { name: fill(en.plan.addAnotherLabel, where) }).click();
  await expect(page).toHaveURL(/\/meals\/new\?date=2026-12-27&slot=dinner$/);
  await page.getByLabel(en.meal.name).fill('Dinner B');
  await page.getByRole('button', { name: en.meal.save }).click();
  await expect(heading(page, 'Dinner B')).toBeVisible();
  await page.getByRole('link', { name: en.meal.back }).click();

  const first = page.getByRole('link', { name: /^27 Dec Dinner\s*, Bolognese\s*, 6 eating$/ });
  const secondName = /^Dinner B\s*, No recipe yet\s*, 6 eating$/;
  const second = page.getByRole('link', { name: secondName });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  // Together in the one cell: the list of its chips holds both.
  const chips = page.getByRole('list').filter({ has: first }).last();
  await expect(chips.getByRole('listitem')).toHaveCount(2);
  await expect(chips.getByRole('link').nth(1)).toHaveAccessibleName(secondName);
  // Side by side: the two chips share a row, the second to the right.
  const [a, b] = [await first.boundingBox(), await second.boundingBox()];
  expect(a && b && Math.abs(a.y - b.y) < 2 && b.x > a.x).toBe(true);
  const meals = api.facts(holidayId)?.meals.filter((meal) => meal.slot === 'dinner') ?? [];
  expect(meals).toHaveLength(2);
  await expectNoAxeViolations(page);
});

test('the Overview lists a meal without a recipe, with a link to fix it', async ({ page }) => {
  await page.goto(`/holidays/${holidayId}`);
  await expect(heading(page, 'Summer')).toBeVisible();
  const warnings = page.getByRole('region', { name: en.overview.warnings.heading });
  await expect(
    warnings.getByText(fill(en.overview.warnings.mealWithoutRecipe, { meal: 'Picnic' }))
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await warnings
    .getByRole('link', { name: fill(en.overview.warnings.chooseRecipeLabel, { meal: 'Picnic' }) })
    .click();

  await expect(heading(page, 'Picnic')).toBeVisible();
  await expect(page.getByText(en.meal.noRecipe)).toBeVisible();
});

test('creates a recipe from the meal editor and comes back with it chosen', async ({
  page,
  api
}) => {
  await page.goto(`/holidays/${holidayId}/meals/new?date=2026-12-28&slot=dinner`);
  await page.getByLabel(en.meal.name).fill('Farewell');
  await page.getByLabel('Bob').uncheck();

  await recipeField(page).fill('Lasagne');
  await page
    .getByRole('option', { name: fill(en.recipePicker.create, { query: 'Lasagne' }) })
    .click();

  await expect(heading(page, en.recipe.newHeading)).toBeVisible();
  await expect(page.getByLabel(en.recipe.name)).toHaveValue('Lasagne');
  const line = page.getByRole('combobox', { name: fill(en.recipe.ingredientLabel, { n: 1 }) });
  await line.fill('mince');
  await line.press('ArrowDown');
  await line.press('Enter');
  await page.getByLabel(fill(en.recipe.quantityLabel, { n: 1 })).fill('400');
  await page.getByRole('button', { name: en.recipe.save }).click();

  // Back on the meal, with the draft as it was and the new recipe chosen.
  await expect(heading(page, en.meal.newHeading)).toBeVisible();
  await expect(page).toHaveURL(/\/meals\/new\?date=2026-12-28&slot=dinner$/);
  await expect(page.getByLabel(en.meal.name)).toHaveValue('Farewell');
  await expect(page.getByLabel('Bob')).not.toBeChecked();
  await expect(page.getByLabel('Ann')).toBeChecked();
  const recipe = page.getByRole('region', { name: en.meal.recipe });
  await expect(recipe.getByText('Lasagne')).toBeVisible();
  await expect(
    preview(page).getByText(
      fill(en.meal.preview.serves, { servings: 5, recipeServings: 4, factor: 1.25 })
    )
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: en.meal.save }).click();
  await expect(heading(page, 'Farewell')).toBeVisible();
  const lasagne = [...api.catalogue.recipes.values()].find((r) => r.name === 'Lasagne');
  const saved = api.facts(holidayId)?.meals.find((meal) => meal.name === 'Farewell');
  expect(saved?.recipeId).toBe(lasagne?.id);
  expect(saved?.mealtimes[0]?.attendeeIds).toHaveLength(5);
});

test('going back from the recipe editor keeps the meal’s draft', async ({ page }) => {
  await page.goto(`/holidays/${holidayId}/meals/new?date=2026-12-28&slot=dinner`);
  await page.getByLabel(en.meal.name).fill('Farewell');
  await recipeField(page).fill('Stew');
  await page.getByRole('option', { name: fill(en.recipePicker.create, { query: 'Stew' }) }).click();

  await page.getByRole('link', { name: en.recipe.backToMeal }).click();

  await expect(heading(page, en.meal.newHeading)).toBeVisible();
  await expect(page.getByLabel(en.meal.name)).toHaveValue('Farewell');
});

test('deletes an attendee who eats a meal, taking them off it first', async ({ page, api }) => {
  await page.goto(`/holidays/${holidayId}/people`);
  await page
    .getByRole('button', { name: fill(en.people.attendees.deleteLabel, { name: 'Ann' }) })
    .click();
  const dialog = page.getByRole('dialog', {
    name: fill(en.people.attendees.deleteHeading, { name: 'Ann' })
  });
  await expect(dialog.getByRole('listitem')).toHaveText(['Picnic']);
  await dialog.getByRole('button', { name: en.people.attendees.deleteConfirm }).click();

  const attendees = page.getByRole('list', { name: en.people.attendees.heading });
  await expect(attendees.getByText('Ann', { exact: true })).toHaveCount(0);
  const meal = api.facts(holidayId)?.meals.find((m) => m.id === picnic.id);
  expect(meal?.mealtimes[0]?.attendeeIds).toEqual([bob.id]);
  expect(api.requests.filter((r) => !r.startsWith('GET'))).toEqual([
    `PUT /holidays/${holidayId}/meals/${picnic.id}`,
    `DELETE /holidays/${holidayId}/attendees/${ann.id}`
  ]);
});
