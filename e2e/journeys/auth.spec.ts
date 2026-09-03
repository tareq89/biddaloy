import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { LoginPage } from '../pages/login-page';
import { escapeRegExp } from '../regex';

/**
 * [8.5.7] Journey 1: login/logout. [8.14.2] adds the staff header's own
 * user menu — this file's "sign out from the staff shell" test drives
 * *that* button, while `e2e/fixtures/session.spec.ts`'s revoked-session
 * spec still covers the server-forced case (session revoked out from
 * under a still-open tab).
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

test.describe('sign out from the staff shell', () => {
  test.use(loggedIn('teacher'));

  test('signing out lands on /login, and Back does not restore the session', async ({ page }) => {
    await page.goto('/dashboard');

    await test.step('open the user menu and sign out', async () => {
      // The trigger's accessible name is `nav.userMenu.label`, optionally
      // suffixed with the signed-in name (`user-menu.tsx:66`), and the app
      // renders Bangla by default — so match the translated label as a
      // prefix rather than hardcoding English.
      await page
        .getByRole('button', { name: new RegExp(escapeRegExp(t('nav.userMenu.label'))) })
        .click();
      await page.getByRole('menuitem', { name: t('nav.userMenu.signOut'), exact: true }).click();
    });

    await test.step('lands on /login', async () => {
      await expect(page).toHaveURL(/\/login/);
    });

    await test.step('Back does not restore the session', async () => {
      await page.goBack();
      await expect(page).toHaveURL(/\/login/);
    });
  });
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
