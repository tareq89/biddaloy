import { expect, loggedIn, test } from './fixtures/test';

/**
 * [8.14.2]'s sticky-header scroll contract — the three things
 * `--app-header-h` (`AppShell`'s `APP_HEADER_HEIGHT_VAR` export) exists
 * to guarantee, and the assertion #369 (route view transitions) inherits
 * wholesale rather than re-proving: a scrolled-away page, a skip-link
 * jump, and a route-change focus target must all land **below** the
 * sticky header, never underneath it. jsdom (used everywhere else in the
 * repo's test suite) has no real layout engine, so this is the one place
 * that can actually measure `getBoundingClientRect()` against a
 * `position: sticky` element.
 *
 * Bangla text throughout: see `e2e/config.ts`'s own comment on why — no
 * persisted locale in a fresh browser context means `bn`, the repo's
 * DEFAULT_LOCALE, renders first regardless of the test environment
 * locale.
 */
test.describe('sticky header scroll contract', () => {
  test.use(loggedIn('admin'));

  test('the skip link lands #main-content below the sticky header, not underneath it', async ({
    page,
  }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

    // Scroll the page down first — the whole point of the contract is
    // that a *scrolled* page still lands its jump target below the
    // header, not just a page that was already at the top.
    await page.mouse.wheel(0, 800);
    // The wheel scroll is asynchronous; let it land before the jump, or it
    // can overwrite the skip link's scroll position.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const a = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(150);
        return a === (await page.evaluate(() => window.scrollY));
      })
      .toBe(true);

    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    const main = page.locator('#main-content');
    await expect(main).toBeFocused();

    const header = page.locator('[data-app-header]');
    // Main's top edge sits at or below the header's bottom edge — the
    // `scroll-padding-top`/`scroll-margin-top` contract's whole job. Polled:
    // the anchor jump can still be settling (smooth scroll) at the first read.
    await expect
      .poll(async () => {
        const [headerBox, mainBox] = await Promise.all([header.boundingBox(), main.boundingBox()]);
        // 2px tolerance: the anchor jump lands on a device-pixel scroll offset.
        return mainBox!.y - (headerBox!.y + headerBox!.height - 2);
      })
      .toBeGreaterThanOrEqual(0);
  });

  test('navigating between routes leaves the focused <h1> fully visible below the header', async ({
    page,
  }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

    await page.mouse.wheel(0, 800);
    await page.getByRole('link', { name: 'ড্যাশবোর্ড', exact: true }).click();

    const heading = page.getByRole('heading', { name: 'ড্যাশবোর্ড' });
    await expect(heading).toBeFocused();

    const header = page.locator('[data-app-header]');
    const [headerBox, headingBox] = await Promise.all([
      header.boundingBox(),
      heading.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  });

  test.describe('phone top bar at 390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('stays at top 0 after scrolling, and the focused <h1> after a route change sits below it', async ({
      page,
    }) => {
      await page.goto('/students');
      await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

      await page.mouse.wheel(0, 1000);
      const bar = page.locator('[data-app-mobile-header]');
      await expect.poll(async () => (await bar.boundingBox())?.y).toBe(0);

      await page.getByRole('button', { name: 'মেনু খুলুন' }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'ড্যাশবোর্ড', exact: true }).click();

      const heading = page.getByRole('heading', { name: 'ড্যাশবোর্ড' });
      await expect(heading).toBeFocused();
      const [barBox, headingBox] = await Promise.all([bar.boundingBox(), heading.boundingBox()]);
      expect(headingBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height - 1);
    });
  });
});
