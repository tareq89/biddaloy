import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

import { waitForSwControl } from './helpers';

/**
 * [8.10.7.5.99] D52: dashboard widgets the service worker replays offline carry a "showing saved
 * data" note; online ones do not. Lives in `e2e/pwa/` because only the built app has a service
 * worker (see `playwright.pwa.config.ts`); the ticket named `journeys/`, which has none.
 *
 * Offline cold boot cannot restore a session, so this stays in one tab: leave the dashboard,
 * wait past TanStack's 30 s `staleTime`, come back offline, and the refetch is answered by the SW.
 */

test.use(loggedIn('admin'));

const NOTICE = t('common.offline.showingSavedData').split('{{age}}')[0]!.trim();

test('offline the cards say saved data; back online they do not', async ({ page, context }) => {
  test.setTimeout(120_000);
  const shell = new AppShellPage(page);
  await page.goto('/dashboard');
  await waitForSwControl(page);
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(NOTICE, { exact: false })).toHaveCount(0);

  // Warm the students page (chunk + data) online, so it can be opened offline later.
  const studentsTitle = page.getByRole('heading', { level: 1, name: t('students.list.title') });
  await shell.navigateTo('nav.items.students');
  await expect(studentsTitle).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shell.navigateTo('nav.items.dashboard');
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');

  await context.setOffline(true);
  await shell.navigateTo('nav.items.students');
  await expect(studentsTitle).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(31_000); // past the 30 s staleTime, so the dashboard refetches
  await shell.navigateTo('nav.items.dashboard');
  await expect(page.getByText(NOTICE, { exact: false }).first()).toBeVisible({ timeout: 30_000 });

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(NOTICE, { exact: false })).toHaveCount(0);
});
