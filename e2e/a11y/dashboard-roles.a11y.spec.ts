import type { Page } from '@playwright/test';

import { expect, loggedIn, test } from '../fixtures/test';
import { makeT, type Locale } from '../i18n';
import type { SeedRole } from '../seed-contract';
import { expectNoAxeViolations } from './assert';

/**
 * [8.10.7.6.05] Axe per ROLE for the dashboard. The manifest sweep (`routes.a11y.spec.ts`) scans
 * `/dashboard` once, as admin; every other role renders a different card set. Same variants as that
 * sweep (bn + en light, bn dark), desktop, then phone (390 px): the page, a tile expanded, and for
 * admin the customise bottom sheet with a draft change. Plus the parent and student portal
 * overview, the homework page and the committee's printable report.
 */

const VARIANTS: { locale: Locale; theme: 'light' | 'dark' }[] = [
  { locale: 'bn', theme: 'light' },
  { locale: 'en', theme: 'light' },
  { locale: 'bn', theme: 'dark' },
];

const ROLES: SeedRole[] = [
  'admin',
  'executive',
  'teacher',
  'accountant',
  'office_staff',
  'exam_controller',
  'committee',
];

async function settle(page: Page) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  // Every card has left its skeleton (loading cards carry aria-busy; the skeleton slot is the
  // stable hook the journeys use).
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function prepare(page: Page, theme: 'light' | 'dark') {
  if (theme === 'dark') {
    // Before the first navigation, like `routes.a11y.spec.ts`: the boot script reads it once.
    await page.addInitScript(() => localStorage.setItem('biddaloy:theme', 'dark'));
  }
}

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
}

for (const { locale, theme } of VARIANTS) {
  test.describe(`dashboard a11y · ${locale}${theme === 'dark' ? ' · dark' : ''} @sweep`, () => {
    for (const role of ROLES) {
      test.describe(role, () => {
        test.use({ ...loggedIn(role), e2eLocale: locale });

        test('desktop dashboard has zero axe violations', async ({ page }) => {
          await prepare(page, theme);
          await page.goto('/dashboard');
          await settle(page);
          await expectTheme(page, theme);
          await expectNoAxeViolations(page);
        });

        test('phone dashboard and an expanded tile have zero axe violations', async ({ page }) => {
          await prepare(page, theme);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.goto('/dashboard');
          await settle(page);
          await expectTheme(page, theme);
          await expectNoAxeViolations(page);

          const tile = page.locator('[data-tile-toggle]:visible').first();
          if ((await tile.count()) > 0) {
            await tile.click();
            await expect(tile).toHaveAttribute('aria-expanded', 'true');
            await expect(page.getByTestId('tile-expanded')).toBeVisible();
            await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, {
              timeout: 20_000,
            });
            await expectNoAxeViolations(page);
          }
        });
      });
    }

    test.describe('customise mode', () => {
      test.use({ ...loggedIn('admin'), e2eLocale: locale });
      const panelTitle = makeT(locale)('dashboard.customise.panelTitle');

      test('desktop customise (draft changed) has zero axe violations', async ({ page }) => {
        await prepare(page, theme);
        await page.goto('/dashboard?customize=1');
        await expect(page.getByRole('heading', { name: panelTitle })).toBeVisible();
        await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
        await expectTheme(page, theme);
        await page.getByRole('checkbox').first().click();
        await expectNoAxeViolations(page);
      });

      test('phone bottom sheet with a focused row has zero axe violations', async ({ page }) => {
        await prepare(page, theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/dashboard?customize=1');
        await expect(page.getByRole('heading', { name: panelTitle })).toBeVisible();
        await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
        await expectTheme(page, theme);
        const box = page.getByRole('checkbox').first();
        await box.focus();
        await expect(box).toBeFocused();
        await expectNoAxeViolations(page);
        await box.click(); // draft state
        await expectNoAxeViolations(page);
      });
    });

    // Portal overview (parent + student) and the committee's printable report.
    for (const role of ['parent', 'student'] as const) {
      test.describe(`portal as ${role}`, () => {
        test.use({ ...loggedIn(role), e2eLocale: locale });

        for (const path of ['/portal', '/portal/homework']) {
          test(`${path} has zero axe violations`, async ({ page }) => {
            await prepare(page, theme);
            await page.goto(path);
            await settle(page);
            await expectTheme(page, theme);
            await expectNoAxeViolations(page);
          });
        }
      });
    }

    test.describe('committee report', () => {
      test.use({ ...loggedIn('committee'), e2eLocale: locale });

      test('/print/committee-report has zero axe violations', async ({ page }) => {
        await prepare(page, theme);
        await page.goto('/print/committee-report');
        await settle(page);
        await expectTheme(page, theme);
        await expectNoAxeViolations(page);
      });
    });
  });
}
