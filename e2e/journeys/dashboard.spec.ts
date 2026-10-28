import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { adminApiSession, get, patch } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

/**
 * [8.10.7.2.99] The admin's /dashboard (page shell, upcoming widget, customise
 * mode) and the Settings > Dashboard risk thresholds. Wave 2 ships only the
 * `upcoming` card as a UI widget; the other eight are covered by
 * `dashboard-widgets-api.spec.ts` until their cards land.
 */

// [#3134] Cold page loads on a slow runner can take more than the default 5 s.
const SLOW = 15_000;
const UPCOMING = () => t('dashboard.widgets.upcoming.title');
const upcomingCard = (page: Page) =>
  page.getByRole('heading', { name: t('calendar.upcomingPanel.title') });
const panel = (page: Page) =>
  page.getByRole('region', { name: t('dashboard.customise.panelTitle') });
// "সাজান" is a substring of the setup card's (?) name "সাহায্য: স্কুল সাজানোর ক্রম" (Epic 44).
const customiseButton = (page: Page) =>
  page
    .getByRole('button', { name: t('dashboard.page.customise') })
    .and(page.locator(':not([data-help-id])'));

async function saveCustomisation(page: Page) {
  await panel(page)
    .getByRole('button', { name: t('dashboard.customise.save'), exact: true })
    .click();
  await expect(customiseButton(page)).toBeVisible();
}

test.describe('dashboard', () => {
  test.use(loggedIn('admin'));

  test('opens from the sidebar with the upcoming card; axe is clean', async ({ page }) => {
    await page.goto('/students');
    await new AppShellPage(page).navigateTo('nav.items.dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
    ).toBeVisible();
    await expect(upcomingCard(page)).toBeVisible({ timeout: SLOW });
    await expectNoAxeViolations(page, 'main');
  });

  test('customise: hide the upcoming card, save, reload, then reset to the default', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(upcomingCard(page)).toBeVisible({ timeout: SLOW });

    await customiseButton(page).click();
    await expect(page).toHaveURL(/customize=1/);
    await expectNoAxeViolations(page, 'main');
    await panel(page).getByRole('checkbox', { name: UPCOMING() }).uncheck();
    await saveCustomisation(page);

    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
    ).toBeVisible();
    await expect(upcomingCard(page)).toHaveCount(0);

    await page.goto('/dashboard?customize=1');
    await panel(page)
      .getByRole('button', { name: t('dashboard.customise.reset') })
      .click();
    await saveCustomisation(page);
    await expect(upcomingCard(page)).toBeVisible();
  });
});

test.describe('dashboard on a phone', () => {
  test.use({ ...loggedIn('admin'), viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the customise panel sits below the preview and Save works by touch', async ({ page }) => {
    await page.goto('/dashboard?customize=1');
    const preview = page.getByText(t('dashboard.customise.preview'));
    await expect(preview).toBeVisible();
    const previewBox = await preview.boundingBox();
    const panelBox = await panel(page).boundingBox();
    expect(panelBox!.y).toBeGreaterThan(previewBox!.y);

    // No change: saving the unchanged layout still goes through.
    await panel(page)
      .getByRole('button', { name: t('dashboard.customise.save'), exact: true })
      .tap();
    await expect(page).not.toHaveURL(/customize=1/);
  });
});

test.describe('settings > dashboard', () => {
  test.use(loggedIn('admin'));

  test('the absent-in-a-row threshold is kept and reaches the at-risk widget', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const settingsPath = `/schools/${admin.tenantId}/settings`;
    const original = await get<{
      version: number;
      dashboard?: {
        risk: Record<string, number>;
        committeeAttendanceTargetPct: number;
        digestTime: string;
      };
    }>(request, admin, settingsPath);
    const before = original.dashboard ?? {
      risk: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
      committeeAttendanceTargetPct: 90,
      digestTime: '07:30',
    };

    try {
      await page.goto('/settings?section=academics');
      const card = page.locator('#dashboard-section');
      await expect(card).toBeVisible({ timeout: SLOW });
      const field = card.getByLabel(t('settings.dashboard.risk.absentStreakDays'));
      await field.fill('4');
      await card.getByRole('button', { name: t('settings.save.action') }).click();
      await expect(card.getByText(t('settings.save.success'))).toBeVisible();

      await page.reload();
      await expect(
        page
          .locator('#dashboard-section')
          .getByLabel(t('settings.dashboard.risk.absentStreakDays')),
      ).toHaveValue('4');
      await expectNoAxeViolations(page, 'main');

      // Either the old list marked stale, or one already computed with the new 4.
      const list = await get<{ stale: boolean; thresholds: { absentStreakDays: number } }>(
        request,
        admin,
        '/dashboard/widgets/at-risk-students',
      );
      expect(list.stale || list.thresholds.absentStreakDays === 4).toBe(true);
    } finally {
      await patch(request, admin, settingsPath, { version: original.version, dashboard: before });
    }
  });
});
