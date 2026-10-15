import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from '../keyboard/keyboard-utils';

/**
 * [8.10.7.4.99] The TEACHER `/dashboard` with the seven wave-4 cards against the seed
 * (`seed.dashboard.ts`): default layout order, the "deadline in 3 days" mark card (D40), reaching the
 * attendance card's primary action with the keyboard only, the phone tiles, and axe in both themes.
 */

const widgetTitle = (key: string) => t(`dashboard.widgets.${key}.title`);
const card = (page: Page, key: string) => page.getByRole('region', { name: widgetTitle(key) });

/** The TEACHER default layout (`ROLE_DEFAULT_LAYOUTS.TEACHER`), in order. */
const TEACHER_KEYS = [
  'my-routine-today',
  'my-pending-sections',
  'my-mark-deadlines',
  'homework-to-check',
  'my-leave-balance',
  'class-teacher-streaks',
  'my-syllabus-progress',
];

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function reloadDark(page: Page) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

test.describe('dashboard: teacher', () => {
  test.use(loggedIn('teacher'));

  test('the seven cards render in layout order; the mark card says the deadline is in 3 days', async ({
    page,
  }) => {
    await openDashboard(page);

    const titles = TEACHER_KEYS.map(widgetTitle);
    const headings = page.locator(
      '[data-testid="grid-desktop"] h2, [data-testid="grid-desktop"] h3',
    );
    await expect
      .poll(async () => (await headings.allTextContents()).filter((h) => titles.includes(h)))
      .toEqual(titles);

    // Seed: the DRAFT "Half-yearly" exam closes today + 3 for the teacher's maths grid.
    await expect(card(page, 'my-mark-deadlines')).toContainText(/শেষ তারিখ [৩3] দিন পর/);
  });

  test('keyboard only: Tab reaches the attendance primary action and Enter opens the register', async ({
    page,
  }) => {
    await openDashboard(page);
    const primary = card(page, 'my-pending-sections').getByRole('link');
    // No primary when the school is off today (Friday) or the teacher's registers are all taken
    // (attendance.spec marks a section for today): say so instead of failing.
    if ((await primary.count()) === 0) {
      test.info().annotations.push({
        type: 'not-exercised',
        description: 'my-pending-sections has no pending register to link to today',
      });
      return;
    }
    const name = (await primary.first().innerText()).trim();
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await tabUntilFocused(page, name, 150, { tag: 'a' });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]{36}/);
  });

  test('axe is clean on the populated page, light and dark', async ({ page }) => {
    await openDashboard(page);
    await expectNoAxeViolations(page, 'main');
    await reloadDark(page);
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('dashboard: teacher on a phone', () => {
  test.use({ ...loggedIn('teacher'), viewport: { width: 390, height: 844 }, hasTouch: true });

  test('key numbers come first as tiles; a tapped tile expands its card; axe is clean', async ({
    page,
  }) => {
    await openDashboard(page);
    await expect(page.getByRole('region', { name: t('dashboard.page.keyNumbers') })).toBeVisible();

    const tile = page.getByTestId('grid-phone').locator('button[aria-expanded]').first();
    await expect(tile).toHaveAttribute('aria-expanded', 'false');
    await tile.tap();
    await expect(tile).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('tile-expanded')).toBeVisible();
    await expectNoAxeViolations(page, 'main');

    await reloadDark(page);
    await expectNoAxeViolations(page, 'main');
  });
});
