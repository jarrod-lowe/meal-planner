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
const annId = '0190a0b0-0000-7000-8000-0000000000a1';
const bobSub = '0190a0b0-0000-7000-8000-0000000000b0';
const fill = (text: string, params: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);

const summer = {
  id: holidayId,
  name: 'Summer',
  timeZone: 'Pacific/Auckland',
  startDate: '2026-12-26',
  endDate: '2027-01-02'
};

test.beforeEach(async ({ page, api }) => {
  api.users = [
    { sub: normal.sub, name: normal.name },
    { sub: bobSub, name: 'Bob Builder' }
  ];
  await page.goto('/');
  await submitSignIn(page, normal.email, normal.password);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('an empty home page offers to create a holiday, with no axe violations', async ({ page }) => {
  await expect(page.getByText(en.home.empty)).toBeVisible();
  await expect(page.getByLabel(en.createHoliday.timeZone)).toHaveValue(/.+/);
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: en.createHoliday.submit }).click();
  await expect(page.getByLabel(en.createHoliday.name)).toBeFocused();
  await expect(page.getByLabel(en.createHoliday.name)).toHaveAccessibleDescription(
    en.createHoliday.errors.nameRequired
  );
  await expectNoAxeViolations(page);
});

test('creating a holiday lands on its overview', async ({ page, api }) => {
  await page.getByLabel(en.createHoliday.name).fill('Summer');
  await page.getByLabel(en.createHoliday.startDate).fill('2026-12-26');
  await page.getByLabel(en.createHoliday.endDate).fill('2027-01-02');
  await page.getByLabel(en.createHoliday.timeZone).selectOption('Pacific/Auckland');
  await page.getByRole('button', { name: en.createHoliday.submit }).click();

  await expect(page).toHaveURL(/\/holidays\/[0-9a-f-]{36}$/);
  await expect(heading(page, 'Summer')).toBeVisible();
  await expect(page.getByText('26 Dec 2026 – 2 Jan 2027')).toBeVisible();
  await expect(page).toHaveTitle(fill(en.overview.title, { name: 'Summer' }));
  const [created] = [...api.holidays.values()];
  expect(created?.holiday).toMatchObject({ name: 'Summer', timeZone: 'Pacific/Auckland' });
  expect(created?.members.has(normal.sub)).toBe(true);

  const nav = page.getByRole('navigation', { name: en.holiday.nav.label });
  await expect(nav.getByRole('link', { name: en.holiday.nav.overview })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(nav.getByRole('link', { name: en.holiday.nav.plan })).toHaveAttribute(
    'href',
    /\/plan$/
  );
  await expect(nav.getByRole('link', { name: new RegExp(en.holiday.nav.trips) })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await expectNoAxeViolations(page);

  // Back home, it's in the list.
  await page.getByRole('link', { name: en.holiday.allHolidays }).click();
  await expect(page.getByRole('link', { name: /Summer/ })).toBeVisible();
});

test('a holiday that doesn’t exist says so, with a way home', async ({ page }) => {
  await page.goto(`/holidays/${holidayId}`);

  await expect(page.getByRole('alert')).toHaveText(en.holiday.errors.notFound);
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: en.holiday.backHome }).click();
  await expect(page).toHaveURL('/');
});

test.describe('people', () => {
  test.beforeEach(async ({ page, api }) => {
    api.seed({ holiday: summer, attendees: [{ id: annId, name: 'Ann' }], members: [normal.sub] });
    await page.goto(`/holidays/${holidayId}/people`);
    await expect(heading(page, en.people.heading)).toBeVisible();
  });

  test('has no axe violations', async ({ page }) => {
    await expect(page.getByRole('link', { name: en.holiday.nav.people })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: en.people.members.leave }).click();
    await expect(page.getByRole('dialog', { name: en.people.members.leaveHeading })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('adds an attendee', async ({ page, api }) => {
    await page.getByLabel(en.people.attendees.newName).fill('Bob');
    await page.getByRole('button', { name: en.people.attendees.add }).click();

    const attendees = page.getByRole('list', { name: en.people.attendees.heading });
    await expect(attendees.getByText('Bob')).toBeVisible();
    await expect
      .poll(() => [...(api.holidays.get(holidayId)?.attendees.values() ?? [])].map((a) => a.name))
      .toEqual(['Ann', 'Bob']);
  });

  test('adds a member from the users list', async ({ page, api }) => {
    await page.getByLabel(en.people.members.addField).selectOption({ label: 'Bob Builder' });
    await page.getByRole('button', { name: en.people.members.add }).click();

    const members = page.getByRole('list', { name: en.people.members.heading });
    await expect(members.getByText('Bob Builder')).toBeVisible();
    await expect.poll(() => api.holidays.get(holidayId)?.members.has(bobSub)).toBe(true);
    await expect(page.getByText(en.people.members.noneToAdd)).toBeVisible();
  });

  test('a version conflict shows their version and offers Refresh holiday', async ({
    page,
    api
  }) => {
    api.conflictNext('PUT', `/holidays/${holidayId}/attendees/${annId}`, {
      id: annId,
      name: 'Anna',
      version: 2,
      updatedAt: '2026-11-28T01:00:00Z',
      updatedBy: bobSub
    });

    await page
      .getByRole('button', { name: fill(en.people.attendees.renameLabel, { name: 'Ann' }) })
      .click();
    const field = page.getByLabel(fill(en.people.attendees.renameField, { name: 'Ann' }));
    await field.fill('Annie');
    await field.press('Enter');

    const toasts = page.getByRole('region', { name: en.toasts.label });
    await expect(toasts.getByText(fill(en.mutate.conflict, { item: 'Annie' }))).toBeVisible();
    const attendees = page.getByRole('list', { name: en.people.attendees.heading });
    await expect(attendees.getByText('Anna')).toBeVisible();

    await toasts.getByRole('button', { name: en.mutate.refreshHoliday }).click();
    await expect
      .poll(() => api.requests.filter((r) => r === `GET /holidays/${holidayId}`).length)
      .toBe(2);
    await expect(toasts.getByText(fill(en.mutate.conflict, { item: 'Annie' }))).toBeHidden();
  });

  test('leaving asks first, then returns home', async ({ page, api }) => {
    api.seed({ holiday: summer, members: [normal.sub, bobSub] });
    await page.reload();

    await page.getByRole('button', { name: en.people.members.leave }).click();
    const dialog = page.getByRole('dialog', { name: en.people.members.leaveHeading });
    await expect(dialog.getByRole('button', { name: en.confirm.cancel })).toBeFocused();
    await dialog.getByRole('button', { name: en.people.members.leaveConfirm }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText(en.home.empty)).toBeVisible();
  });

  test('the last member can’t leave, and is told why', async ({ page }) => {
    await page.getByRole('button', { name: en.people.members.leave }).click();
    await page
      .getByRole('dialog', { name: en.people.members.leaveHeading })
      .getByRole('button', { name: en.people.members.leaveConfirm })
      .click();

    await expect(page.getByRole('alert')).toHaveText(en.people.members.lastMember);
    await expect(page).toHaveURL(`/holidays/${holidayId}/people`);
  });
});
