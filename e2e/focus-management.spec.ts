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
    // Resets keyboard focus to the very start of the document, rather
    // than a second `page.goto()` reload — a hard reload re-triggers a
    // real cold-boot silent-refresh network round trip, which is its own
    // concern (session persistence across a real reload), not what this
    // test is about. "First Tab stop" is a DOM-order property of
    // `AppShell`, provable from any already-loaded page.
    //
    // `document.activeElement.blur()` alone is *not* enough here: it
    // moves `document.activeElement` to `<body>`, but Chrome's Tab-key
    // sequence cursor keeps tracking the just-blurred element's DOM
    // position rather than resetting to the top of the document — Tab
    // then lands on whatever comes after *that* element, not the page's
    // actual first tab stop (verified manually: after `beforeEach` lands
    // on the dashboard, `useRouteFocus` has already focused its `<h1>`;
    // blurring it and pressing Tab landed on the page's action button,
    // several stops past the skip link). Giving `<body>` a real, if
    // temporary, `tabindex` and calling `.focus()` on it does reset that
    // cursor correctly.
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });

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
    // The RouteAnnouncer's aria-live region — the other half of what a
    // screen-reader visitor actually gets on a route change, not just
    // where visual/programmatic focus lands. `data-slot`, not the bare
    // `[aria-live="polite"]` attribute: a loading `Button`'s own live
    // region and a toast library's notification region both match that
    // too on a real page.
    await expect(page.locator('[data-slot="route-announcer"]')).toHaveText('শিক্ষার্থী');
  });
});
