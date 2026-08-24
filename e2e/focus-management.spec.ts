import { expect, loggedIn, test } from './fixtures/test';

/**
 * [8.9.7]'s three ACs only a real browser can prove:
 * - the skip link is the *first* Tab stop and its `href="#..."` jump
 *   actually moves focus, not just scrolls (jsdom, used everywhere else
 *   in the repo's test suite, doesn't implement browser focus
 *   behaviour realistically);
 * - a route change moves focus to the new page and never leaves it on
 *   `<body>`;
 * - `document.title` updates per route.
 *
 * Auth comes from the [8.5.2] storageState fixtures — no UI login here.
 * Bangla text throughout: see `e2e/config.ts`'s own comment on why — no
 * persisted locale in a fresh browser context means `bn`, the repo's
 * DEFAULT_LOCALE, renders first regardless of test environment locale.
 */
test.describe('focus management, skip link, route announcements', () => {
  test.use(loggedIn('admin'));

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();
  });

  test('skip link is the first Tab stop and moves focus to #main-content', async ({ page }) => {
    // On an already-loaded page `useRouteFocus` has focused the route's
    // `<h1>` — blurring alone leaves the Tab cursor at the just-blurred DOM
    // position rather than resetting to the top of the document, so Tab
    // would land on whatever comes after *that* element, not the page's
    // actual first tab stop. Giving `<body>` a real, if temporary,
    // `tabindex` and calling `.focus()` on it resets the cursor correctly.
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

    // RouteAnnouncer's aria-live region — the other half of the
    // screen-reader story next to visual/programmatic focus.
    await expect(page.locator('[data-slot="route-announcer"][aria-live="polite"]')).toHaveText(
      'শিক্ষার্থী',
    );
  });
});
