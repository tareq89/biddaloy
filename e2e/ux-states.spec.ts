import { expect, loggedIn } from './fixtures/test';
import { test } from './fixtures/settings-lock';

/**
 * [3329.2.99] The ten UX states, proven on the five key pages in a real browser
 * (jsdom has no `navigator.onLine` events and no real network). Bangla text, as in
 * the other specs: the default locale renders when no locale is stored. The words
 * come from `ui/src/i18n/locales/bn/states.json` (the `states` namespace is not in
 * `e2e/i18n.ts`, so they are written out here).
 *
 * - offline: the banner says "ইন্টারনেট নেই", and is gone when the net returns.
 * - expired: a 401 that cannot refresh opens the sign-in dialog and nothing is sent again (Rule 25).
 * - denied / error / empty: read from the students list with mocked answers.
 *
 * `serviceWorkers: 'block'` so `page.route()` and `setOffline` see every request.
 */
const OFFLINE_TITLE = 'ইন্টারনেট নেই';
const EXPIRED_TITLE = 'আবার লগইন করুন';
const DENIED_TITLE = 'আপনার অনুমতি নেই';
const ERROR_TITLE = 'কিছু একটা ঠিক হয়নি';
const ERROR_RETRY = 'আবার চেষ্টা করুন';
const EMPTY_TITLE = 'এখানে এখনো কিছু নেই';

const PAGES = [
  { name: 'dashboard', role: 'admin', path: '/dashboard' },
  { name: 'students list', role: 'admin', path: '/students' },
  { name: 'fees collection', role: 'accountant', path: '/fees' },
  { name: 'attendance mark', role: 'teacher', path: '/attendance' },
  { name: 'portal home', role: 'parent', path: '/portal' },
] as const;

for (const p of PAGES) {
  test.describe(p.name, () => {
    test.use(loggedIn(p.role));
    test.use({ serviceWorkers: 'block' });

    test('offline banner shows, then goes when the net returns', async ({ page, context }) => {
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(OFFLINE_TITLE)).toHaveCount(0);

      await context.setOffline(true);
      await expect(page.getByRole('status').filter({ hasText: OFFLINE_TITLE })).toBeVisible();

      await context.setOffline(false);
      await expect(page.getByText(OFFLINE_TITLE)).toHaveCount(0);
    });

    test('session end opens the dialog; nothing is replayed', async ({ page }) => {
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');

      let apiCalls = 0;
      const gone = { statusCode: 401, message: 'Unauthorized' };
      await page.route('**/api/v1/auth/refresh', (route) =>
        route.fulfill({ status: 401, json: gone }),
      );
      await page.route(/\/api\/v1\/(?!auth\/)/, (route) => {
        apiCalls += 1;
        return route.fulfill({ status: 401, json: gone });
      });
      // Returning to the tab refetches active queries; that read gets the 401.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));

      await expect(page.getByRole('dialog').getByText(EXPIRED_TITLE)).toBeVisible();
      const seen = apiCalls;
      await page.waitForTimeout(1500);
      expect(apiCalls).toBe(seen); // no replay
    });
  });
}

test.describe('students list: denied, error, empty', () => {
  test.use(loggedIn('admin'));
  test.use({ serviceWorkers: 'block' });
  const LIST = /\/api\/v1\/students(\?|$)/;

  test('403 shows the denied state', async ({ page }) => {
    await page.route(LIST, (route) =>
      route.fulfill({ status: 403, json: { statusCode: 403, message: 'Forbidden' } }),
    );
    await page.goto('/students');
    await expect(page.getByText(DENIED_TITLE)).toBeVisible();
  });

  test('500 shows the error state and Retry reloads', async ({ page }) => {
    let fail = true;
    await page.route(LIST, (route) =>
      fail
        ? route.fulfill({ status: 500, json: { statusCode: 500, message: 'Server error' } })
        : route.continue(),
    );
    await page.goto('/students');
    await expect(page.getByText(ERROR_TITLE)).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: ERROR_RETRY }).click();
    await expect(page.getByText(ERROR_TITLE)).toHaveCount(0);
  });

  test('an empty school shows the empty state', async ({ page }) => {
    await page.route(LIST, (route) =>
      route.fulfill({
        status: 200,
        json: { data: [], items: [], total: 0, page: 1, limit: 20, next_cursor: null },
      }),
    );
    await page.goto('/students');
    await expect(page.getByText(EMPTY_TITLE)).toBeVisible();
  });
});
