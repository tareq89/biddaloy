import { expect, guest, loggedIn, test } from './test';
import { shells } from '../config';

/**
 * [8.5.2] Proves the storageState fixtures are complete sessions:
 * - cold boot with only the refresh cookie silently refreshes exactly
 *   once and renders the app (the SPA keeps access tokens in memory only,
 *   so this bootstrap is what every authenticated spec relies on);
 * - a revoked session falls through to /login instead of half-rendering;
 * - the multi-membership admin lands on /select-school without a
 *   persisted tenant, and straight in the app with one.
 */

test.describe('refresh-path bootstrap', () => {
  test.use(loggedIn('admin'));

  test('cold boot refreshes exactly once and renders without a /login redirect', async ({
    page,
  }) => {
    let refreshCalls = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/v1/auth/refresh')) refreshCalls += 1;
    });

    await page.goto('/students');

    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();
    expect(page.url()).not.toContain('/login');
    expect(refreshCalls).toBe(1);
  });
});

test.describe('revoked session', () => {
  test.use(loggedIn('teacher'));

  test('a logged-out cookie redirects to /login instead of half-rendering', async ({ page }) => {
    // Revoke server-side first — page.request shares the page's own
    // browsing context, so it carries the refresh cookie the login set;
    // the standalone `request` fixture is its own context and would not.
    const response = await page.request.post('/api/v1/auth/logout');
    expect(response.ok()).toBe(true);

    await page.goto('/students');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: shells.app.heading })).toBeVisible();
  });
});

test.describe('tenant persistence', () => {
  test.describe('without a persisted tenant', () => {
    test.use(loggedIn('admin', { tenant: 'none' }));

    test('multi-membership admin lands on the school picker', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/select-school/);
    });
  });

  test.describe('with a persisted tenant', () => {
    test.use(loggedIn('admin'));

    test('admin goes straight into the app', async ({ page }) => {
      await page.goto('/');
      await expect(page).not.toHaveURL(/\/select-school/);
      await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();
    });
  });
});

test.describe('guest', () => {
  test.use(guest);

  test('an unauthenticated visit redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
