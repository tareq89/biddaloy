import { expect, loggedIn, test } from './fixtures/test';

/**
 * [8.14.5] — the route-transitions ticket's own acceptance criteria,
 * proven against a real browser for the reasons every other spec in this
 * directory gives: jsdom (the rest of the repo's test suite) has no real
 * layout engine and doesn't implement `document.startViewTransition()`
 * at all, so "the header/sidebar never move" and "no blank content
 * area" can only be shown here.
 *
 * Sticky-header/focus-below-header coverage already lives in
 * `sticky-header.spec.ts` (#366) — this file inherits that rather than
 * re-proving it, per that file's own header comment.
 *
 * Bangla text throughout: see `e2e/config.ts`'s own comment on why — no
 * persisted locale in a fresh browser context means `bn`, the repo's
 * `DEFAULT_LOCALE`, renders first regardless of the test environment's
 * own locale.
 */
test.describe('route transitions', () => {
  test.use(loggedIn('admin'));

  test('navigating between two staff routes never blanks #main-content and never moves the header or sidebar', async ({
    page,
  }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

    const header = page.locator('[data-app-header]');
    const nav = page.getByRole('navigation', { name: 'প্রধান' });
    const [headerBoxBefore, navBoxBefore] = await Promise.all([
      header.boundingBox(),
      nav.boundingBox(),
    ]);
    expect(headerBoxBefore).not.toBeNull();
    expect(navBoxBefore).not.toBeNull();

    const main = page.locator('#main-content');

    // Poll `#main-content`'s text content across the navigation — it must
    // never read empty. A single before/after snapshot could miss a
    // blank frame that only exists for a handful of frames mid-transition.
    let sawBlank = false;
    const pollId = setInterval(() => {
      void main.textContent().then((text) => {
        if (text !== null && text.trim() === '') sawBlank = true;
      });
    }, 20);

    await page.getByRole('link', { name: 'অভিভাবক', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'অভিভাবক' })).toBeVisible();

    clearInterval(pollId);
    expect(sawBlank).toBe(false);

    const [headerBoxAfter, navBoxAfter] = await Promise.all([
      header.boundingBox(),
      nav.boundingBox(),
    ]);
    expect(headerBoxAfter).toEqual(headerBoxBefore);
    expect(navBoxAfter).toEqual(navBoxBefore);
  });

  test('a slow route shows the progress bar within ~400ms and the pending skeleton, never a 500ms dead hold', async ({
    page,
  }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

    // Delay the guardians list response well past `defaultPendingMs`
    // (200ms) so the pending UI has to show, but resolve it quickly
    // enough after that the test doesn't spend real time proving a
    // "still not there yet" dead hold that's the whole thing this AC
    // rules out.
    await page.route('**/api/v1/guardians**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    const clickedAt = Date.now();
    await page.getByRole('link', { name: 'অভিভাবক', exact: true }).click();

    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 400 });
    expect(Date.now() - clickedAt).toBeLessThan(400);

    await expect(page.locator('[data-route-pending]')).toBeVisible();
    await expect(page.locator('#main-content')).not.toBeEmpty();

    await expect(page.getByRole('heading', { name: 'অভিভাবক' })).toBeVisible({
      timeout: 5000,
    });
    // The pending skeleton is gone once the real page has taken over —
    // proves there's no dead hold keeping it up past when data arrived.
    await expect(page.locator('[data-route-pending]')).toHaveCount(0);
  });

  test('a fresh cold visit to a deep route never blanks on i18n namespace loading', async ({
    page,
  }) => {
    // A brand-new context (no `beforeEach` navigation first) landing
    // straight on a leaf route — the exact case `loadRouteNamespaces`
    // in that route's own `loader` exists to cover.
    await page.goto('/fee-structures');
    await expect(page.locator('#main-content')).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'ফি কাঠামো' })).toBeVisible();
  });
});
