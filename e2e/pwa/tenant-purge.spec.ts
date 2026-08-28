import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

import {
  activeTenantId,
  apiCacheKeysForTenant,
  readQueueRows,
  refCacheKeysForTenant,
  seedQueueRow,
  waitForOfflineDb,
  waitForSwControl,
} from './helpers';

/**
 * [8.12.6] AC 7 — switching school purges the cached data of the school
 * being left.
 *
 * Three stores hold a tenant's data, and a switch has to deal with each
 * differently. This spec pins all three, including the asymmetry, because
 * the asymmetry is a decision that would otherwise look like a bug:
 *
 * | store | on switch | why |
 * |---|---|---|
 * | SW `api-cache` | purged (`clearApiCache`) | another school's HTTP responses |
 * | Dexie `refCache` | purged (`purgeTenantRefCache`) | another school's rows |
 * | Dexie `mutationQueue` | **kept** | it is the user's unsaved work |
 *
 * The queue is not purged and must not be: a cached read is reproducible,
 * a queued mutation is not (`mutation-queue.ts`'s header). Isolation for
 * it is structural instead — every replay and every snapshot filters on
 * the active tenant — which is why this spec asserts the row is still in
 * IndexedDB while the indicator under the *other* school reports nothing
 * waiting.
 *
 * The switch is performed offline. That is not scene-setting: it keeps
 * the seeded row from being replayed mid-test (a tenant switch fires an
 * auth-state change, which is one of the engine's replay triggers), and
 * the switch itself is entirely local state (`switchActiveTenant`), so
 * nothing about it needs the network.
 */
test.describe('tenant switch purges cached data', () => {
  test.use(loggedIn('admin'));

  test('leaving a school drops its caches but keeps its unsent work', async ({ page, context }) => {
    const shell = new AppShellPage(page);

    await page.goto('/dashboard');
    await waitForSwControl(page);
    const tenantA = await activeTenantId(page);
    await waitForOfflineDb(page);

    await test.step('fill both caches with Default School data', async () => {
      await shell.navigateTo('nav.items.students');
      await expect(page.getByRole('heading', { name: t('students.list.title') })).toBeVisible();
      await expect
        .poll(() => apiCacheKeysForTenant(page, tenantA).then((keys) => keys.length))
        .toBeGreaterThan(0);
      await expect
        .poll(() => refCacheKeysForTenant(page, tenantA).then((keys) => keys.length))
        .toBeGreaterThan(0);
    });

    await context.setOffline(true);
    await seedQueueRow(page, {
      tenantId: tenantA,
      method: 'patch',
      // Never sent in this spec — the row exists to be *survived*, not
      // replayed. Non-money path, same rule as every other seeded row.
      path: '/students/00000000-0000-4000-8000-000000000000',
      body: { home_address: 'e2e-tenant-purge' },
    });

    await test.step('switch to Rose Valley School', async () => {
      await shell.switchSchool('Rose Valley School');
      await shell.expectCurrentSchool('Rose Valley School');
    });

    await test.step("the old school's cached reads are gone", async () => {
      await expect
        .poll(() => apiCacheKeysForTenant(page, tenantA).then((keys) => keys.length), {
          message: 'clearApiCache() should have dropped the api-cache',
        })
        .toBe(0);
      await expect
        .poll(() => refCacheKeysForTenant(page, tenantA).then((keys) => keys.length), {
          message: 'purgeTenantRefCache() should have dropped the leaving tenant rows',
        })
        .toBe(0);
    });

    await test.step("the old school's queued work is not thrown away", async () => {
      const rows = await readQueueRows(page);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(tenantA);
      expect(rows[0]?.status).toBe('pending');
    });

    await test.step('but the new school is not told about it', async () => {
      // Offline with nothing of *this* tenant's waiting: the chip says
      // "You're offline" with no count. `sync.offlineWithCount` would mean
      // the snapshot had leaked the other school's row.
      await expect(page.getByRole('button', { name: t('common.sync.offline') })).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('common.sync.offlineWithCount_one') }),
      ).toHaveCount(0);
    });

    await context.setOffline(false);
  });
});
