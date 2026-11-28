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
const flourId = '0190a0b0-0000-7000-8000-0000000000f1';
const milkId = '0190a0b0-0000-7000-8000-0000000000f2';
const fill = (text: string, params: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
const appNav = (page: Page) => page.getByRole('navigation', { name: en.appNav.label });

test.beforeEach(async ({ page, api }) => {
  api.seedCatalogue({
    ingredients: [
      { id: flourId, name: 'Flour', unit: 'g', shopSection: 'pantry', deleted: false },
      { id: milkId, name: 'Milk', unit: 'ml', shopSection: 'dairy', deleted: false }
    ]
  });
  await page.goto('/');
  await submitSignIn(page, normal.email, normal.password);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('the header links the app’s sections and marks the current one', async ({ page }) => {
  const nav = appNav(page);
  await expect(nav.getByRole('link', { name: en.appNav.holidays })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await nav.getByRole('link', { name: en.appNav.recipes }).click();
  await expect(heading(page, en.recipes.heading)).toBeVisible();
  await expect(nav.getByRole('link', { name: en.appNav.recipes })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(nav.getByRole('link', { name: en.appNav.holidays })).not.toHaveAttribute(
    'aria-current'
  );
});

test('adds an ingredient from a common suggestion, with no axe violations', async ({
  page,
  api
}) => {
  await appNav(page).getByRole('link', { name: en.appNav.ingredients }).click();
  await expect(heading(page, en.ingredients.heading)).toBeVisible();
  await expect(page.getByRole('list', { name: en.shopSections.pantry })).toContainText('Flour');
  await expectNoAxeViolations(page);

  await page.getByRole('searchbox', { name: en.ingredients.search }).fill('basil');
  const add = page.getByRole('button', {
    name: fill(en.ingredients.addSuggestionLabel, {
      name: 'Basil',
      unit: 'bunch',
      section: en.shopSections.produce
    })
  });
  await expectNoAxeViolations(page);
  await add.click();

  const produce = page.getByRole('list', { name: en.shopSections.produce });
  await expect(produce).toContainText(fill(en.ingredients.row, { name: 'Basil', unit: 'bunch' }));
  await expect
    .poll(() => [...api.catalogue.ingredients.values()].map((i) => `${i.name} ${i.unit}`))
    .toContain('Basil bunch');

  // The add form and its duplicate warning are accessible too.
  await page.getByRole('searchbox', { name: en.ingredients.search }).fill('');
  await page.getByRole('button', { name: en.ingredients.add }).click();
  const form = page.getByRole('form', { name: en.ingredients.addForm });
  await form.getByLabel(en.ingredientForm.name).fill('flour');
  await form.getByLabel(en.ingredientForm.unit).fill('g');
  await form.getByLabel(en.ingredientForm.unit).press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    fill(en.ingredientForm.duplicate, { name: 'Flour', unit: 'g' })
  );
  await expectNoAxeViolations(page);
});

test('builds a recipe with the keyboard, then hides it and shows it again', async ({
  page,
  api
}) => {
  await appNav(page).getByRole('link', { name: en.appNav.recipes }).click();
  await expect(page.getByText(en.recipes.empty)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: en.recipes.new }).click();
  await expect(heading(page, en.recipe.newHeading)).toBeVisible();
  await expect(page).toHaveTitle(en.recipe.newTitle);
  await expectNoAxeViolations(page);

  // Keyboard only from here: type, arrows, Enter, Tab.
  await page.getByLabel(en.recipe.name).focus();
  await page.keyboard.type('Pancakes');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('4');

  const picker = (n: number) =>
    page.getByRole('combobox', { name: fill(en.recipe.ingredientLabel, { n }) });
  const quantity = (n: number) => page.getByLabel(fill(en.recipe.quantityLabel, { n }));

  await picker(1).focus();
  await page.keyboard.type('flour');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(quantity(1)).toBeFocused();
  await page.keyboard.type('200');
  await page.keyboard.press('Enter');

  await expect(picker(2)).toBeFocused();
  await page.keyboard.type('milk');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(quantity(2)).toBeFocused();
  await page.keyboard.type('300');
  await page.keyboard.press('Enter');

  // Eggs aren't in the catalogue: the first option is the common suggestion.
  await expect(picker(3)).toBeFocused();
  await page.keyboard.type('eggs');
  await page.keyboard.press('ArrowDown');
  await expect(picker(3)).toHaveAttribute('aria-activedescendant', /.+/);
  const active = page.locator(`[id="${await picker(3).getAttribute('aria-activedescendant')}"]`);
  await expect(active).toContainText(en.picker.addToCatalogue);
  await page.keyboard.press('Enter');
  await expect(quantity(3)).toBeFocused();
  await page.keyboard.type('2');

  await page.getByRole('button', { name: en.recipe.save }).focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(heading(page, 'Pancakes')).toBeVisible();
  const eggs = [...api.catalogue.ingredients.values()].find((i) => i.name === 'Eggs');
  expect(eggs).toBeDefined();
  const [saved] = [...api.catalogue.recipes.values()];
  expect(saved).toMatchObject({
    name: 'Pancakes',
    servings: 4,
    deleted: false,
    lines: [
      { ingredientId: flourId, quantity: 200 },
      { ingredientId: milkId, quantity: 300 },
      { ingredientId: eggs?.id, quantity: 2 }
    ]
  });

  await page.reload();
  await expect(heading(page, 'Pancakes')).toBeVisible();
  await expect(quantity(2)).toHaveValue('300');
  await expect(page.getByText(/^Milk · ml/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Hide it: it leaves the list, unless Show hidden is on.
  await page.getByRole('button', { name: en.recipe.hide }).click();
  await expect(page.getByText(en.recipe.hiddenNote)).toBeVisible();
  await expect.poll(() => api.catalogue.recipes.get(saved?.id ?? '')?.deleted).toBe(true);
  await page.getByRole('link', { name: en.recipe.back }).click();
  await expect(page.getByRole('link', { name: 'Pancakes' })).toHaveCount(0);

  await page.getByRole('checkbox', { name: en.recipes.showHidden }).check();
  const list = page.getByRole('list', { name: en.recipes.heading });
  await expect(list.getByRole('listitem')).toContainText(en.recipes.hidden);
  await expectNoAxeViolations(page);
  await list
    .getByRole('button', { name: fill(en.recipes.showAgainLabel, { name: 'Pancakes' }) })
    .click();
  await expect(list.getByRole('listitem')).not.toContainText(en.recipes.hidden);
  await expect.poll(() => api.catalogue.recipes.get(saved?.id ?? '')?.deleted).toBe(false);
});

test('hides an ingredient and shows it again', async ({ page, api }) => {
  await page.goto('/ingredients');
  await page
    .getByRole('button', { name: fill(en.ingredients.hideLabel, { name: 'Milk', unit: 'ml' }) })
    .click();
  await expect(page.getByText(fill(en.ingredients.row, { name: 'Milk', unit: 'ml' }))).toHaveCount(
    0
  );
  await expect.poll(() => api.catalogue.ingredients.get(milkId)?.deleted).toBe(true);

  await page.getByRole('checkbox', { name: en.ingredients.showHidden }).check();
  await expectNoAxeViolations(page);
  await page
    .getByRole('button', {
      name: fill(en.ingredients.showAgainLabel, { name: 'Milk', unit: 'ml' })
    })
    .click();
  await expect.poll(() => api.catalogue.ingredients.get(milkId)?.deleted).toBe(false);
});

test('an unknown recipe says so', async ({ page }) => {
  await page.goto('/recipes/0190a0b0-0000-7000-8000-00000000dead');
  await expect(heading(page, en.recipe.notFound.heading)).toBeVisible();
  await expectNoAxeViolations(page);
});
