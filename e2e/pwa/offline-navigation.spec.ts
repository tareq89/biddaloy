import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';
import { ListShellPage } from '../pages/list-shell';

import { activeTenantId, apiCacheKeysForTenant, cacheKeys, waitForSwControl } from './helpers';
import { ASSET_CACHE_NAME } from './helpers';

/**
 * [8.12.6] AC 2 — offline navigation: a route whose code *and* data are
 * already cached still works with the network down and says so; a route
 * that was never visited fails into the designed offline state instead of
 * a broken page.
 *
 * ## The shape of the test, and why it is two pages
 *
 * ```text
 *  page A (online)   visit /students ──▶ SW api-cache + Dexie refCache warm
 *                                        route chunk in asset-cache
 *  page B (online)   boot on /dashboard ──▶ session restored, empty query cache
 *  page B  OFFLINE   navigate to /students ──▶ served from the caches, labelled
 *                    navigate to /audit-logs ──▶ chunk missing ──▶ offline state
 * ```
 *
 * The second page is not ceremony. TanStack Query's `staleTime` is 30s
 * (`ui/src/api/query-client.ts`), so re-visiting `/students` in the *same*
 * tab would be answered from memory without ever touching the service
 * worker — the spec would pass while proving nothing about the cache. A
 * second tab has an empty query cache, so its first offline render must
 * come from the SW's `api-cache` (or Dexie), which is the thing under
 * test.
 *
 * Page B boots while still online on purpose: an offline cold boot cannot
 * restore the session (`/auth/refresh` needs the network), so it would
 * land on `/login` — see `installability.spec.ts`, which asserts exactly
 * that as the honest behaviour.
 *
 * Offline is always `context.setOffline()`. `context.route()` is never
 * used to fake it: route interception does not see service-worker
 * requests, so a routed "offline" test passes while the worker quietly
 * serves everything.
 */
test.describe('offline navigation', () => {
  test.use(loggedIn('admin'));

  test('a visited route renders from cache and is labelled as saved data', async ({
    page,
    context,
  }) => {
    const shell = new AppShellPage(page);

    await page.goto('/dashboard');
    await waitForSwControl(page);
    const tenantId = await activeTenantId(page);

    await test.step('warm the caches with a real online visit', async () => {
      await shell.navigateTo('nav.items.students');
      await expect(page.getByRole('heading', { name: t('students.list.title') })).toBeVisible();
      // The SW cached the list response under this tenant's key —
      // `apiCacheKeyFor`'s `__tenant` param (`pwa/cache-policy.ts`).
      await expect
        .poll(() => apiCacheKeysForTenant(page, tenantId).then((keys) => keys.length), {
          message: 'GET /students should be in api-cache under this tenant',
        })
        .toBeGreaterThan(0);
      // And the route's own lazily-fetched chunk is in the asset cache,
      // which is what makes the offline navigation below possible at all.
      await expect
        .poll(() => cacheKeys(page, ASSET_CACHE_NAME).then((keys) => keys.length))
        .toBeGreaterThan(0);
    });

    const second = await context.newPage();
    const secondShell = new AppShellPage(second);
    await second.goto('/dashboard');
    await waitForSwControl(second);
    // Settle before pulling the plug. A chunk or data fetch still in
    // flight when `setOffline` lands aborts, and an aborted dynamic
    // import is indistinguishable from a chunk deleted by a deploy —
    // `classifyRouteError` reads `navigator.onLine`, which has not
    // necessarily flipped yet at that instant, so the tab renders the
    // *update* state. Real, and worth knowing about, but not what this
    // spec is measuring.
    await expect(second.getByRole('navigation', { name: t('nav.navLabel') })).toBeVisible();
    await second.waitForLoadState('networkidle');

    await context.setOffline(true);

    await test.step('offline, the students list still renders — from the cache', async () => {
      await secondShell.navigateTo('nav.items.students');
      // Generous: the SW's API route is `NetworkFirst` with a 5s network
      // timeout (`sw.ts`), so the *first* offline read deliberately waits
      // out that timeout before falling back to `api-cache`. Anything
      // under ~6s here is a test that fails on the app being correct.
      await expect(second.getByRole('heading', { name: t('students.list.title') })).toBeVisible({
        timeout: 20_000,
      });
      // Labelled, not silently stale: the epic's rule is that cached data
      // is only acceptable when the user is told it is cached.
      // `offline.showingSavedData` interpolates an age, so the assertion
      // matches the fixed part of the sentence.
      const [savedDataPrefix] = t('common.offline.showingSavedData').split('{{age}}');
      await expect(second.getByText(savedDataPrefix!.trim(), { exact: false })).toBeVisible({
        timeout: 20_000,
      });
      await expect(second.getByText(t('common.offline.youAreOffline'))).toBeVisible();
    });

    await test.step('data that was never cached falls into the offline state', async () => {
      // A filter nobody has ever run: the route's chunk is cached, but
      // its `loader` re-runs for the new search (`loaderDeps`) and there
      // is no `api-cache` entry and no Dexie row for this query. The
      // loader therefore fails with a real `ERR_NETWORK`, and the route's
      // error boundary renders `RouteStatusState`'s offline fork rather
      // than a broken table.
      //
      // The copy comes through `e2e/i18n.ts` like everything else:
      // `main.tsx` now passes `RouteErrorFallback` its translated
      // overrides, so a Bangla-default app no longer shows this one
      // screen — the one a user sees precisely when nothing else works —
      // in English.
      const list = new ListShellPage(second, {
        titleKey: 'students.list.title',
        searchLabelKey: 'students.list.searchLabel',
      });
      await list.search(`never-cached-${Date.now()}`);
      await expect(
        second.getByRole('heading', { name: t('common.offline.pageTitle') }),
      ).toBeVisible({ timeout: 20_000 });
    });

    await test.step('back online, the route loads again', async () => {
      await context.setOffline(false);
      // Recovery is asserted by navigating again rather than by clicking
      // the offline state's own "Try again". That button calls the
      // router's `reset()`, and on this route it does *not* recover after
      // reconnecting — the failed loader result stays cached, so the
      // offline state re-renders indefinitely. That is a real defect in
      // the retry affordance (it needs a router invalidation, not a
      // re-render) and is reported rather than papered over here; pinning
      // it as expected behaviour is not something a test should do.
      await secondShell.navigateTo('nav.items.dashboard');
      await secondShell.navigateTo('nav.items.students');
      await expect(second.getByRole('heading', { name: t('students.list.title') })).toBeVisible({
        timeout: 20_000,
      });
      await expect(second.getByRole('heading', { name: /you're offline/i })).toHaveCount(0);
    });
  });
});
