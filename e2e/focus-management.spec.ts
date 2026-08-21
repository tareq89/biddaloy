import { test, expect } from '@playwright/test';

import { shells } from './config';

/**
 * [8.9.7]'s three ACs that only a real browser can prove:
 * - the skip link is the *first* Tab stop and its `href="#..."` jump
 *   actually moves focus, not just scrolls (jsdom, used everywhere else
 *   in this repo's test suite, doesn't implement that browser focus
 *   behaviour realistically);
 * - a route change moves focus to the new page and never leaves it on
 *   `<body>`;
 * - `document.title` updates per route.
 *
 * `client-admin`'s routes are all auth-guarded (`__root.tsx`'s
 * `beforeLoad`), and no E2E auth fixture exists yet ([8.5.2]/[8.5.3] is
 * that ticket's job) — this signs in with the seeded manual-QA `ADMIN`
 * account instead (`server/src/scripts/seed.util.ts`'s
 * `ensureRoleTestUsers`, `admin@biddaloy.test` / `SEED_ADMIN_PASSWORD`),
 * the one already-real, already-seeded way to reach an authenticated
 * screen today, rather than inventing a parallel fixture here.
 *
 * Bangla text throughout: `admin/config.ts`'s own comment on why — no
 * persisted locale in a fresh browser context means `bn`, this repo's
 * `DEFAULT_LOCALE`, renders first regardless of test environment locale.
 */
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

test.describe('focus management, skip link, and route announcements', () => {
  test.skip(!ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD is not set — see server/.env.example');

  test.beforeEach(async ({ page }) => {
    await page.goto(shells.admin.baseURL);
    await page.getByLabel('ইমেইল বা ফোন নম্বর').fill('admin@biddaloy.test');
    await page.getByLabel('পাসওয়ার্ড').fill(ADMIN_PASSWORD ?? '');
    await page.getByRole('button', { name: 'লগ ইন', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();
  });

  test('the skip link is the first Tab stop and jumps focus to the main content', async ({
    page,
  }) => {
    // A fresh navigation, not a continuation of the login form's own tab
    // order — this is what "first Tab stop on the page" actually means.
    await page.goto(shells.admin.baseURL);
    await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'মূল বিষয়বস্তুতে যান' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('a route change moves focus to the new page and updates the title, never leaving focus on <body>', async ({
    page,
  }) => {
    await expect(page).toHaveTitle('ড্যাশবোর্ড · বিদ্যালয়');

    await page.getByRole('link', { name: 'শিক্ষার্থী', exact: true }).click();

    const heading = page.getByRole('heading', { name: 'শিক্ষার্থী' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle('শিক্ষার্থী · বিদ্যালয়');
    await expect(page.locator('body')).not.toBeFocused();
  });
});
