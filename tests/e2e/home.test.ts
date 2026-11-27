import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { en } from '../../src/lib/i18n/en.js';

test('home page shows the app title and has no axe violations', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(en.app.title);
  await expect(page.getByRole('heading', { level: 1, name: en.app.title })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
