import { clearPlatformAlerts, openPlatformAlert } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [75.35] The red platform-alert banner: SUPER_ADMIN only, sticky, not
 * dismissable, gone after the alert clears. The e2e server runs with
 * NODE_ENV=test, so the live probe is off and the rows below are the truth.
 */
// The banner text starts with the time, so match on the fixed part after it.
const BANNER = t('attention.platformAlert.REDIS_DOWN', { time: '' }).trim();

test.afterEach(async () => {
  await clearPlatformAlerts();
});

test.describe('as SUPER_ADMIN', () => {
  test.use(loggedIn('super_admin'));

  test('platform console shows the banner and keeps it in view on scroll', async ({ page }) => {
    await openPlatformAlert();
    await page.goto('/schools');
    const banner = page.getByRole('status').filter({ hasText: BANNER });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);
    const box = await banner.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });

  test('staff shell shows it too, and a reload after clearing shows none', async ({ page }) => {
    await openPlatformAlert();
    await page.goto('/dashboard');
    const banner = page.getByRole('status').filter({ hasText: BANNER });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await clearPlatformAlerts();
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
    await expect(banner).toHaveCount(0);
  });

  test('phone: visible with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlatformAlert();
    await page.goto('/schools');
    await expect(page.getByRole('status').filter({ hasText: BANNER })).toBeVisible({
      timeout: 15_000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

test.describe('as ADMIN', () => {
  test.use(loggedIn('admin'));

  test('sees no banner and never requests /platform/alerts', async ({ page }) => {
    await openPlatformAlert();
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/platform/alerts')) requests.push(r.url());
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('status').filter({ hasText: BANNER })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});
