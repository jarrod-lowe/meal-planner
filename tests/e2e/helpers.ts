import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { en } from '../../src/lib/i18n/en.js';

export { en };
export { fakeResetCode, fakeUsers } from '../../src/lib/auth/fake.js';

/** Fails on any axe violation in the current page state. */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name });
}

export const greeting = (name: string) => en.home.greeting.replace('{name}', name);

/** Fills the sign-in form and submits it with Enter. */
export async function submitSignIn(page: Page, email: string, password: string) {
  await expect(heading(page, en.login.signIn.heading)).toBeVisible();
  await page.getByLabel(en.login.email).fill(email);
  const passwordField = page.getByLabel(en.login.password, { exact: true });
  await passwordField.fill(password);
  await passwordField.press('Enter');
}

export async function fillNewPassword(page: Page, password: string, confirm = password) {
  await page.getByLabel(en.login.newPassword, { exact: true }).fill(password);
  await page.getByLabel(en.login.confirmPassword).fill(confirm);
}
