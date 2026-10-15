import type { Page } from '@playwright/test';

import { expect, loggedIn, test } from '../fixtures/test';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../pages/assertions';
import type { SeedRole } from '../seed-contract';
import { undersizedTargets } from './assert';

/**
 * [8.10.7.6.05] Reflow (WCAG 1.4.10, 320 px), target size 24 px (SC 2.5.8, desktop) and the repo's
 * 44 px phone rule, per dashboard ROLE, in customise mode, on the portal overview and on the
 * committee report. The manifest sweeps (`reflow.spec.ts`, `target-size.spec.ts`) see `/dashboard`
 * only as admin and never at `?customize=1` on a phone.
 */

const ROLES: SeedRole[] = [
  'admin',
  'executive',
  'teacher',
  'accountant',
  'office_staff',
  'exam_controller',
  'committee',
];

async function open(page: Page, path: string, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function expectReflow(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoInnerHorizontalScroll(page);
}

async function expectTargets(page: Page, minimum: number, label: string) {
  const undersized = await undersizedTargets(page, minimum);
  expect(
    undersized,
    `targets under ${minimum}x${minimum} on ${label}:\n${undersized.join('\n')}`,
  ).toEqual([]);
}

for (const role of ROLES) {
  test.describe(`dashboard · ${role} @sweep`, () => {
    test.use(loggedIn(role));

    test('no horizontal scroll at 320px', async ({ page }) => {
      await open(page, '/dashboard', 320);
      await expectReflow(page);
    });

    test('desktop targets are at least 24x24', async ({ page }) => {
      await open(page, '/dashboard', 1280, 900);
      await expectTargets(page, 24, '/dashboard');
    });

    test('phone targets are at least 44x44', async ({ page }) => {
      await open(page, '/dashboard', 390);
      await expectTargets(page, 44, '/dashboard');
    });
  });
}

test.describe('dashboard customise mode @sweep', () => {
  test.use(loggedIn('admin'));

  test('no horizontal scroll at 320px (draft changed)', async ({ page }) => {
    await open(page, '/dashboard?customize=1', 320);
    await page.getByRole('checkbox').first().click();
    await expectReflow(page);
  });

  test('desktop targets are at least 24x24', async ({ page }) => {
    await open(page, '/dashboard?customize=1', 1280, 900);
    await expectTargets(page, 24, '/dashboard?customize=1');
  });

  test('phone bottom sheet targets are at least 44x44', async ({ page }) => {
    await open(page, '/dashboard?customize=1', 390);
    await expectTargets(page, 44, '/dashboard?customize=1');
  });
});

const PAGES: { role: SeedRole; path: string }[] = [
  { role: 'parent', path: '/portal' },
  { role: 'student', path: '/portal' },
  { role: 'parent', path: '/portal/homework' },
  { role: 'committee', path: '/print/committee-report' },
];

for (const { role, path } of PAGES) {
  test.describe(`${path} · ${role} @sweep`, () => {
    test.use(loggedIn(role));

    test('no horizontal scroll at 320px', async ({ page }) => {
      await open(page, path, 320);
      await expectReflow(page);
    });

    test('desktop targets are at least 24x24', async ({ page }) => {
      await open(page, path, 1280, 900);
      await expectTargets(page, 24, path);
    });

    test('phone targets are at least 44x44', async ({ page }) => {
      await open(page, path, 390);
      await expectTargets(page, 44, path);
    });
  });
}
