import { expect, test } from './fixtures.js';
import {
  en,
  expectNoAxeViolations,
  fakeResetCode,
  fakeUsers,
  fillNewPassword,
  greeting,
  heading,
  submitSignIn
} from './helpers.js';

const { normal, firstLogin } = fakeUsers;
const newPassword = 'a brand new password';

test('the guard sends a signed-out visitor to /login with next', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2F');
  await expect(page).toHaveTitle(en.login.title);
  await expect(heading(page, en.login.signIn.heading)).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a wrong password shows an alert tied to the form', async ({ page }) => {
  await page.goto('/login');
  await submitSignIn(page, normal.email, 'not the password');

  await expect(page.getByRole('alert')).toHaveText(en.login.errors.invalidCredentials);
  const password = page.getByLabel(en.login.password, { exact: true });
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAccessibleDescription(en.login.errors.invalidCredentials);
  await expect(page).toHaveURL('/login');
  await expectNoAxeViolations(page);
});

test('first login sets a new password, then signs in', async ({ page }) => {
  await page.goto('/');
  await submitSignIn(page, firstLogin.email, firstLogin.password);

  await expect(heading(page, en.login.newPasswordStep.heading)).toBeFocused();
  await expect(page.getByLabel(en.login.newPassword, { exact: true })).toHaveAccessibleDescription(
    en.login.passwordHelp
  );
  await expectNoAxeViolations(page);

  await fillNewPassword(page, newPassword, 'something different');
  await page.getByRole('button', { name: en.login.newPasswordStep.submit }).click();
  await expect(page.getByRole('alert')).toHaveText(en.login.errors.mismatch);
  await expect(page.getByLabel(en.login.confirmPassword)).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page);

  await fillNewPassword(page, 'too short');
  await page.getByRole('button', { name: en.login.newPasswordStep.submit }).click();
  await expect(page.getByRole('alert')).toHaveText(en.login.errors.passwordPolicy);

  await fillNewPassword(page, newPassword);
  await page.getByRole('button', { name: en.login.newPasswordStep.submit }).click();
  await expect(page).toHaveURL('/');
  await expect(heading(page, greeting(firstLogin.name))).toBeVisible();
});

test('forgot password resets with the emailed code', async ({ page }) => {
  await page.goto('/login');
  await expect(heading(page, en.login.signIn.heading)).toBeVisible();
  await page.getByRole('button', { name: en.login.forgotPassword }).click();

  await expect(heading(page, en.login.forgotPasswordStep.heading)).toBeFocused();
  await expectNoAxeViolations(page);
  await page.getByLabel(en.login.email).fill(normal.email);
  await page.getByRole('button', { name: en.login.forgotPasswordStep.submit }).click();

  await expect(heading(page, en.login.resetCodeStep.heading)).toBeFocused();
  await expect(page.getByLabel(en.login.code)).toHaveAttribute('autocomplete', 'one-time-code');
  await expectNoAxeViolations(page);

  await page.getByLabel(en.login.code).fill('000000');
  await fillNewPassword(page, newPassword);
  await page.getByRole('button', { name: en.login.resetCodeStep.submit }).click();
  await expect(page.getByRole('alert')).toHaveText(en.login.errors.invalidCode);
  await expect(page.getByLabel(en.login.code)).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel(en.login.code).fill(fakeResetCode);
  await page.getByRole('button', { name: en.login.resetCodeStep.submit }).click();

  await expect(heading(page, en.login.resetDoneStep.heading)).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(en.login.resetDoneStep.message);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: en.login.backToSignIn }).click();

  await submitSignIn(page, normal.email, newPassword);
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('next is honoured after sign-in', async ({ page }) => {
  await page.goto('/?view=week#today');
  await expect(page).toHaveURL('/login?next=%2F%3Fview%3Dweek%23today');
  await submitSignIn(page, normal.email, normal.password);
  await expect(page).toHaveURL('/?view=week#today');
});

test('a next with no matching route goes home', async ({ page }) => {
  await page.goto('/login?next=%2Fnowhere%3Fsort%3Dname');
  await submitSignIn(page, normal.email, normal.password);
  await expect(page).toHaveURL('/');
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('an off-site next is ignored', async ({ page }) => {
  await page.goto('/login?next=//evil.com');
  await submitSignIn(page, normal.email, normal.password);
  await expect(page).toHaveURL('/');
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});

test('the sign-in form works from the keyboard alone', async ({ page }) => {
  await page.goto('/login');
  await expect(heading(page, en.login.signIn.heading)).toBeVisible();
  await page.getByLabel(en.login.email).focus();
  await page.keyboard.type(normal.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(normal.password);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: en.login.signIn.submit })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(heading(page, greeting(normal.name))).toBeVisible();
});
