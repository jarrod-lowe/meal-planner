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
const fill = (text: string, params: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);

test.beforeEach(async ({ page, api }) => {
  api.users = [{ sub: normal.sub, name: normal.name }];
  api.seed({
    holiday: {
      id: holidayId,
      name: 'Summer',
      timeZone: 'Pacific/Auckland',
      startDate: '2026-12-26',
      endDate: '2026-12-28'
    },
    attendees: [{ id: '0190a0b0-0000-7000-8000-0000000000a1', name: 'Ann' }],
    members: [normal.sub]
  });
  await page.goto('/');
  await submitSignIn(page, normal.email, normal.password);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('the planner shows the days, and a + opens a prefilled meal editor', async ({ page }) => {
  await page.goto(`/holidays/${holidayId}/plan`);
  await expect(heading(page, en.plan.heading)).toBeVisible();
  await expect(page).toHaveTitle(fill(en.plan.title, { name: 'Summer' }));
  await expectNoAxeViolations(page);

  // The table on desktop, the list of days on phones: either way, one + is visible.
  const add = page.getByRole('link', {
    name: fill(en.plan.addLabel, { slot: en.slots.dinner, date: 'Sun 27 Dec' })
  });
  await expect(add).toHaveCount(1);
  await add.click();

  await expect(page).toHaveURL(/\/meals\/new\?date=2026-12-27&slot=dinner$/);
  await expect(page.getByLabel(en.meal.name)).toHaveValue('27 Dec Dinner');
  await expect(page.getByLabel(en.meal.time)).toHaveValue('18:30');
  await expect(page.getByLabel('Ann')).toBeChecked();
  await expectNoAxeViolations(page);
});
