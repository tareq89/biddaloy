import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.5.99] COMMITTEE dashboard and the printable monthly report against the seed
 * (`seed.dashboard.ts`): four aggregate cards with no links (D23), the table toggle, the report
 * (four tables, `window.print` on Print, Back), the phone tiles, and who else can reach the report.
 * Aggregates only: nothing in the page text names a person or a phone number.
 */

const CARDS = [
  'committee-enrollment',
  'committee-attendance',
  'committee-finance',
  'committee-pass-rate',
] as const;
const title = (key: string) => t(`dashboard.widgets.${key}.title`);
// The summary banner above is also a region whose name contains these words: scope to the grid.
const card = (page: Page, key: string) =>
  page.getByTestId('grid-desktop').getByRole('region', { name: title(key), exact: true });

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

/** No seeded person or phone shows up in the text of a committee page. */
async function expectNoPersonalData(page: Page) {
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/01[3-9]\d{8}/); // a BD mobile number
  expect(text).not.toMatch(/@biddaloy\.test/);
  expect(text).not.toContain('Parent User');
}

test.describe('dashboard: committee', () => {
  test.use(loggedIn('committee'));

  test('privacy line, four cards with no links, and each card opens its table', async ({
    page,
  }) => {
    await openDashboard(page);
    await expect(page.getByText(t('dashboard.committeeSummary.privacyNote'))).toBeVisible();

    for (const key of CARDS) {
      const c = card(page, key);
      await expect(c, key).toBeVisible();
      // D23: nothing inside a committee card leads to another page.
      await expect(c.getByRole('link'), key).toHaveCount(0);
      await c.getByRole('button', { name: t('dashboard.widgets.common.showTable') }).click();
      await expect(c.getByRole('table'), key).toBeVisible();
    }
    await expectNoPersonalData(page);
  });

  test('the print button opens the report: four tables, Print calls window.print, Back returns', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await openDashboard(page);
    await page.getByRole('link', { name: t('dashboard.committeeSummary.printReport') }).click();

    await expect(page).toHaveURL(/\/print\/committee-report/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.committeeReport.title') }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(4);
    await expect(page.getByText(t('dashboard.committeeReport.footer'))).toBeVisible();
    await expectNoPersonalData(page);

    await page.getByRole('button', { name: t('dashboard.committeeReport.print') }).click();
    expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);

    await page.getByRole('link', { name: t('dashboard.committeeReport.back') }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('axe on the dashboard and the report, light and dark', async ({ page }) => {
    await openDashboard(page);
    await expectNoAxeViolations(page);
    await page.goto('/print/committee-report');
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.committeeReport.title') }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoAxeViolations(page);
    await reloadDark(page);
    await expectNoAxeViolations(page);
    await page.goto('/dashboard');
    await reloadDark(page);
    await expectNoAxeViolations(page);
  });

  test('phone 390px: 2x2 key-number tiles; a compact card expands to its table', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
    const strip = page.getByRole('region', { name: t('dashboard.page.keyNumbers') });
    await expect(strip).toBeVisible();
    const tiles = strip.locator(':scope > *');
    await expect(tiles).toHaveCount(4);
    const boxes = await Promise.all([0, 1, 2, 3].map((i) => tiles.nth(i).boundingBox()));
    // 2x2: tiles 0 and 1 share a row, 2 and 3 the next one.
    expect(Math.abs((boxes[0]?.y ?? 0) - (boxes[1]?.y ?? 99))).toBeLessThan(4);
    expect(boxes[2]?.y ?? 0).toBeGreaterThan((boxes[0]?.y ?? 0) + 20);

    const phone = page.getByTestId('grid-phone');
    await phone.getByRole('button', { name: new RegExp(title('committee-finance')) }).click();
    await phone.getByRole('button', { name: t('dashboard.widgets.common.showTable') }).click();
    await expect(phone.getByRole('table').first()).toBeVisible();
  });
});

test.describe('committee report: other roles', () => {
  test.describe('executive', () => {
    test.use(loggedIn('executive'));

    test('no print button on the dashboard; the palette action opens the report', async ({
      page,
    }) => {
      await openDashboard(page);
      await expect(
        page.getByRole('link', { name: t('dashboard.committeeSummary.printReport') }),
      ).toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+k');
      await expect(
        page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
      ).toBeFocused();
      await page.keyboard.type('>');
      await page.keyboard.type('সভার');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/print\/committee-report/);
      await expect(
        page.getByRole('heading', { level: 1, name: t('dashboard.committeeReport.title') }),
      ).toBeVisible();
    });
  });

  test.describe('teacher', () => {
    test.use(loggedIn('teacher'));

    test('the report route is refused', async ({ page }) => {
      await page.goto('/print/committee-report');
      await expect(
        page.getByRole('heading', { level: 1, name: t('dashboard.committeeReport.title') }),
      ).toHaveCount(0);
      // The route stays put and renders the "no permission" screen, not the report.
      await expect(
        page.getByRole('heading', { level: 1, name: t('common.accessDenied.title') }),
      ).toBeVisible();
    });
  });
});
