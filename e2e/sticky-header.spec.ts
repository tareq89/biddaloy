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
    const [headerBox, mainBox] = await Promise.all([header.boundingBox(), main.boundingBox()]);
    expect(headerBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    // Main's top edge sits at or below the header's bottom edge — the
    // `scroll-padding-top`/`scroll-margin-top` contract's whole job.
    expect(mainBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
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
});
