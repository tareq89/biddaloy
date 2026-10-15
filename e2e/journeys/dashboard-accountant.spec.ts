import type { Page } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y/assert';
import { adminApiSession, patch } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.4.99] The ACCOUNTANT `/dashboard` with the wave-4 cards against the seed
 * (`seed.dashboard.ts`), plus the two catalogue cards the ADMIN adds through Customise
 * (`homework-submission-rate`, `recent-activity`).
 */

const widgetTitle = (key: string) => t(`dashboard.widgets.${key}.title`);
const card = (page: Page, key: string) => page.getByRole('region', { name: widgetTitle(key) });

/** The ACCOUNTANT default layout (`ROLE_DEFAULT_LAYOUTS.ACCOUNTANT`), in order. */
const ACCOUNTANT_KEYS = [
  'collection-today',
  'collection-month',
  'fee-generation-status',
  'reminders-pending',
  'collection-by-month',
  'dues-ageing',
  'recent-payments',
  'dues-by-class',
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

test.describe('dashboard: accountant', () => {
  test.use(loggedIn('accountant'));

  test('the eight cards render in layout order; collection-today lists the BANK group with its methods', async ({
    page,
  }) => {
    await openDashboard(page);

    const titles = ACCOUNTANT_KEYS.map(widgetTitle);
    const headings = page.locator(
      '[data-testid="grid-desktop"] h2, [data-testid="grid-desktop"] h3',
    );
    await expect
      .poll(async () => (await headings.allTextContents()).filter((h) => titles.includes(h)))
      .toEqual(titles);

    // Seed: cash, bKash and a card payment today; card is a BANK method.
    const bank = card(page, 'collection-today').getByTestId('group-BANK');
    await expect(bank).toBeVisible();
    await expect(bank.getByTestId('group-label')).toHaveText(
      t('dashboard.widgets.collection-today.group.BANK'),
    );
    await expect(bank.locator('li')).not.toHaveCount(0);
  });

  test('the ageing chart switches to its table by keyboard', async ({ page }) => {
    await openDashboard(page);
    const ageing = card(page, 'dues-ageing');
    const toggle = ageing.getByRole('button', { name: t('dashboard.widgets.common.showTable') });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(ageing.getByRole('table')).toBeVisible();
    // The same toggle now goes back to the chart.
    await expect(
      ageing.getByRole('button', { name: t('dashboard.widgets.common.showChart') }),
    ).toBeVisible();
  });

  test('the reminders card sends the accountant to the reminders page', async ({ page }) => {
    await openDashboard(page);
    const action = card(page, 'reminders-pending').getByRole('link', {
      name: t('dashboard.widgets.reminders-pending.action'),
    });
    // A spec that sends reminders can clear the pending list; then the card has no action.
    if ((await action.count()) === 0) {
      test.info().annotations.push({
        type: 'not-exercised',
        description: 'reminders-pending has nothing pending, so no action link',
      });
      return;
    }
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/communications\/reminders/);
  });

  test('axe is clean on the populated page, light and dark', async ({ page }) => {
    await openDashboard(page);
    await expectNoAxeViolations(page, 'main');
    await reloadDark(page);
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('dashboard: accountant on a phone', () => {
  test.use({ ...loggedIn('accountant'), viewport: { width: 390, height: 844 }, hasTouch: true });

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

test.describe('dashboard: admin adds the wave-4 catalogue cards', () => {
  test.use(loggedIn('admin'));

  test('homework-submission-rate and recent-activity render once the admin has them in the layout', async ({
    page,
    request,
  }) => {
    const KEYS = ['homework-submission-rate', 'recent-activity'];
    // Customise only lists the role default plus what is already saved: it has no "add from the
    // catalogue" control (reported on the ticket), so the layout is saved through the same
    // endpoint Customise's Save uses.
    const admin = await adminApiSession(request);
    try {
      await page.goto('/dashboard?customize=1');
      for (const key of KEYS) {
        await expect(
          page
            .getByRole('region', { name: t('dashboard.customise.panelTitle') })
            .getByRole('checkbox', { name: widgetTitle(key) }),
        ).toHaveCount(0);
      }
      await patch(request, admin, '/users/me/preferences/dashboard', {
        widgets: KEYS.map((key) => ({ key })),
      });
      await openDashboard(page);
      for (const key of KEYS) await expect(card(page, key)).toBeVisible();
    } finally {
      // Not part of the journey: put the admin's layout back to the role default.
      await page.goto('/dashboard?customize=1');
      await page.getByRole('button', { name: t('dashboard.customise.reset') }).click();
      await page.getByRole('button', { name: t('dashboard.customise.save'), exact: true }).click();
      await expect(page).not.toHaveURL(/customize=1/);
    }
  });
});
