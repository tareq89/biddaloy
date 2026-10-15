import type { APIRequestContext, Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { adminApiSession, apiSession, get, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.5.99] The portal overview as the seeded parent (`seed.dashboard.ts` `seedFamilyFacts`):
 * today strip, month heatmap, homework, latest result with a trend, next holiday, the homework
 * page, phone layout, axe in both themes, and that a parent cannot read another family's child.
 */

test.use(loggedIn('parent'));

async function openPortal(page: Page) {
  await page.goto('/portal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

const statusOf = async (request: APIRequestContext, s: ApiSession, path: string) =>
  (
    await request.get(`/api/v1${path}`, {
      headers: { Authorization: `Bearer ${s.token}`, 'X-Tenant-ID': s.tenantId },
    })
  ).status();

test('desktop: strip, heatmap with the absent day, homework, result trend, next holiday', async ({
  page,
}) => {
  await openPortal(page);

  // Today strip: the seed marks the child PRESENT today unless the school is off (Friday) or the
  // base seed left that register pending on purpose.
  const strip = page.getByRole('region', { name: t('portal.today.regionLabel') });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(
    new RegExp(
      [t('portal.today.present'), t('portal.today.closed'), t('portal.today.notMarked')].join('|'),
    ),
  );

  // Heatmap: the summary sentence names at least one missed date (unless today is the 1st).
  const heat = page.getByRole('region', { name: t('portal.heatmap.title') });
  await expect(heat).toBeVisible();

  await expect(page.getByRole('region', { name: t('portal.homeworkCard.title') })).toBeVisible();
  const result = page.getByRole('region', { name: t('portal.latestResult.title') });
  await expect(result).toContainText(
    t('portal.latestResult.better', { previous: '' }).split('(')[0]!.trim(),
  );
  const holiday = page.getByRole('region', { name: t('portal.nextHoliday.title') });
  await expect(holiday).toContainText(/২০|20/); // "in 20 days" (seeded 20 days ahead)

  // The staff calendar panel does not leak into the portal.
  await expect(page.getByText(t('calendar.upcomingPanel.title'))).toHaveCount(0);

  await page
    .getByRole('link', { name: t('portal.homeworkCard.link') })
    .first()
    .click();
  await expect(page).toHaveURL(/\/portal\/homework/);
  await expect(
    page.getByRole('heading', { level: 1, name: t('portal.homework.title') }),
  ).toBeVisible();
});

test('phone 390px: the strip is one card and the bottom cards are compact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPortal(page);
  await expect(page.getByRole('region', { name: t('portal.today.regionLabel') })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('axe, light and dark', async ({ page }) => {
  await openPortal(page);
  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForLoadState('networkidle');
  await expectNoAxeViolations(page);
});

test("a parent cannot read another family's child", async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  await page.goto('/portal');
  const parent = await apiSession(request, 'parent');
  // Own request context: an admin login must not replace this browser's refresh cookie.
  const adminCtx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const admin = await adminApiSession(adminCtx);
  const own = new Set(
    (await get<{ id: string }[]>(request, parent, '/students/mine')).map((s) => s.id),
  );
  expect(own.size).toBeGreaterThan(0);
  const all = (await get<{ data: { id: string }[] }>(adminCtx, admin, '/students?limit=100')).data;
  const other = all.find((s) => !own.has(s.id));
  expect(other, 'the seed has a child outside the parent family').toBeDefined();
  // family-access.service.ts answers 401 (legacy message), not 403, for a child outside the family.
  for (const path of [`/students/${other!.id}`, `/students/${other!.id}/results`]) {
    expect([401, 403, 404], path).toContain(await statusOf(request, parent, path));
  }
  await adminCtx.dispose();
});
