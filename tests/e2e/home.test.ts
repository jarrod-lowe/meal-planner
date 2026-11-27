import { expect, test } from '@playwright/test';
import {
  en,
  expectNoAxeViolations,
  fakeUsers,
  greeting,
  heading,
  submitSignIn
} from './helpers.js';

const { normal } = fakeUsers;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await submitSignIn(page, normal.email, normal.password);
});

test('greets the signed-in user and has no axe violations', async ({ page }) => {
  await expect(page).toHaveURL('/');
  await expect(page).toHaveTitle(en.home.title);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
  await expectNoAxeViolations(page);
});

test('keeps the session across a reload', async ({ page }) => {
  await expect(heading(page, greeting(normal.name))).toBeVisible();
  await page.reload();
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('signing out returns to /login and ends the session', async ({ page }) => {
  await page.getByRole('button', { name: en.home.signOut }).click();

  await expect(page).toHaveURL(/^[^?]*\/login(\?|$)/);
  await expect(heading(page, en.login.signIn.heading)).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2F');
});
