import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { LoginPage } from '../pages/login-page';

/**
 * [8.5.7] Journey 1: login/logout. The app has no logout UI yet (no user
 * menu exists) — server-side logout + redirect is covered by
 * `e2e/fixtures/session.spec.ts`'s revoked-session spec; this file owns
 * the form-level journeys.
 */

const password = () => {
  const value = process.env[SEED_PASSWORD_ENV];
  if (!value) throw new Error(`${SEED_PASSWORD_ENV} not set`);
  return value;
};

test.use(guest);

test('wrong password shows a form error and does not navigate', async ({ page }) => {
  const login = new LoginPage(page);
  await test.step('submit bad credentials', async () => {
    await login.goto();
    await login.login(SEED_ROLE_EMAILS.teacher, 'definitely-wrong-password');
  });
  await test.step('form error, still on /login', async () => {
    await login.expectInvalidCredentials();
    await expect(page).toHaveURL(/\/login/);
  });
});

test('staff login lands in the app', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(SEED_ROLE_EMAILS.teacher, password());
  await expect(page).toHaveURL(/\/dashboard/);
});

test('guardian login lands in the portal', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(SEED_ROLE_EMAILS.parent, password());
  await expect(page).toHaveURL(/\/portal/);
});

test.describe('protected visit after logout', () => {
  test.use(loggedIn('teacher'));

  test('redirects to /login once the session is revoked', async ({ page }) => {
    await test.step('revoke server-side', async () => {
      // page.request shares the page's own browsing context, so it
      // carries the refresh cookie the login set — the standalone
      // `request` fixture is its own context and would not.
      const response = await page.request.post('/api/v1/auth/logout');
      expect(response.ok()).toBe(true);
    });
    await test.step('protected visit redirects', async () => {
      await page.goto('/students');
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
