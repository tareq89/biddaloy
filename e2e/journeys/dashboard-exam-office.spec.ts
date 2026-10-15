import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { apiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.5.99] EXAM_CONTROLLER and OFFICE_STAFF dashboards against the seed
 * (`seed.dashboard.ts`): the seat-plan and results cards, the admissions / guardians / students
 * cards (phone tiles and desktop cards), and the guardians link landing on a list whose total is
 * the card's number. Axe on both.
 */

const title = (key: string) => t(`dashboard.widgets.${key}.title`);
const card = (page: Page, key: string) => page.getByRole('region', { name: title(key) });

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('dashboard: exam controller', () => {
  test.use(loggedIn('exam_controller'));

  test('seat-plan and results cards show seeded data and link to the seat-plan page', async ({
    page,
  }) => {
    await openDashboard(page);
    const seats = card(page, 'seat-plan-status');
    await expect(seats).toBeVisible();
    await expect(card(page, 'results-state')).toBeVisible();
    // The seed leaves a DRAFT plan that covers 2 of 3 sittings, so the card has a body, not the empty state.
    await expect(
      seats.getByRole('link', { name: t('dashboard.widgets.seat-plan-status.link') }),
    ).toHaveAttribute('href', /\/exams\/seat-plans/);
    await expectNoAxeViolations(page);
  });
});

test.describe('dashboard: office staff', () => {
  test.use(loggedIn('office_staff'));

  test('desktop cards; the guardians link lands on the incomplete list with the card total', async ({
    page,
    request,
  }) => {
    await openDashboard(page);
    for (const key of ['admissions-today', 'guardians-incomplete', 'students-added-today']) {
      await expect(card(page, key), key).toBeVisible();
    }
    const office = await apiSession(request, 'office_staff');
    const data = await get<{ incomplete_count: number }>(
      request,
      office,
      '/dashboard/widgets/guardians-incomplete',
    );
    expect(data.incomplete_count).toBeGreaterThan(0); // the seed's incomplete guardian

    await card(page, 'guardians-incomplete')
      .getByRole('link', { name: t('dashboard.widgets.guardians-incomplete.link') })
      .click();
    await expect(page).toHaveURL(/\/guardians\?incomplete=1/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const list = await get<{ meta?: { total?: number }; total?: number }>(
      request,
      office,
      '/guardians?incomplete=true&limit=1',
    );
    expect(list.meta?.total ?? list.total).toBe(data.incomplete_count);
    await expectNoAxeViolations(page);
  });

  test('phone 390px: the three cards are tiles', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
    const phone = page.getByTestId('grid-phone');
    for (const key of ['admissions-today', 'guardians-incomplete', 'students-added-today']) {
      await expect(
        phone.getByText(t(`dashboard.widgets.${key}.tileLabel`)).first(),
        key,
      ).toBeVisible();
    }
  });
});
