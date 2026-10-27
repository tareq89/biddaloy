import { expect, loggedIn, test } from './fixtures/test';
import { expectNoAxeViolations } from './a11y/assert';

/**
 * [44.2.03] In-app help (?) end to end: keyboard, phone, F1, palette, widget, axe.
 * The base URL is the one CI builds client-admin with (`VITE_HANDBOOK_URL`, E12).
 */
const GUIDE = 'https://schoolmanagerp.gitbook.io/schoolmanagerp-docs/bn/attendance/attendance';
const PAGE_HELP = 'button[data-help-id="attendance.attendance"]';

test.use(loggedIn('teacher'));

test.describe('page help on /attendance', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((url?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await page.goto('/attendance');
    await expect(page.locator(PAGE_HELP)).toBeVisible();
  });

  test('keyboard: Tab to the (?), Enter opens, Tab reaches the guide link, Esc returns focus', async ({
    page,
  }) => {
    const hint = page.locator(PAGE_HELP);
    await expect(hint).toHaveAttribute('aria-label', /^সাহায্য:/);

    // A cold load leaves the <h1> unfocusable (route focus adds tabindex only on navigation),
    // so make the heading right before the (?) focusable, then Tab from it.
    await hint.evaluate((el) => {
      const h1 = el.previousElementSibling as HTMLElement;
      h1.tabIndex = -1;
      h1.focus();
    });
    await page.keyboard.press('Tab');
    await expect(hint).toBeFocused();

    await page.keyboard.press('Enter');
    const link = page.getByRole('link', { name: 'গাইড দেখুন' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', GUIDE);
    await expect(link).toBeFocused(); // a keyboard open moves focus into the card (E1)

    await expectNoAxeViolations(page, '[role="dialog"]');

    await page.keyboard.press('Escape');
    await expect(link).toBeHidden();
    await expect(hint).toBeFocused();
  });

  test('F1 opens the guide page; F1 inside a text input does nothing', async ({ page }) => {
    const opened = () =>
      page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

    // Nothing focused yet after the load: F1 opens the guide.
    await page.keyboard.press('F1');
    await expect.poll(opened).toEqual([GUIDE]);

    // The palette's search box is a real text input; F1 there must not open a second tab.
    await page.keyboard.press('ControlOrMeta+k');
    const search = page.getByRole('dialog').getByRole('combobox');
    await search.press('F1');
    await expect(search).toBeFocused();
    expect(await opened()).toEqual([GUIDE]);
  });

  test('Ctrl+K lists "এই পাতার সাহায্য" on the Action tab', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    // The teacher's palette opens on People; a leading ">" switches to Action (D11).
    await page.getByRole('dialog').getByRole('combobox').press('>');
    await expect(page.getByRole('option', { name: 'এই পাতার সাহায্য' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    // Touch must be on for `tap()`; the desktop projects have none (same as dashboard.spec.ts).
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('a tap opens the card inside the viewport with no horizontal scroll', async ({ page }) => {
      await page.locator(PAGE_HELP).tap();
      const card = page.getByRole('dialog').filter({ hasText: 'গাইড দেখুন' });
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(390 - 32);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});

test('dashboard: a widget (?) links to its anchor in the guide', async ({ page }) => {
  await page.goto('/dashboard');
  // Desktop grid only: the hidden phone grid can render a second card for the same widget
  // (a closed school day or a loading tile), which would break strict mode.
  const hint = page
    .getByTestId('grid-desktop')
    .locator('button[data-help-id="widget.my-pending-sections"]');
  await expect(hint).toBeVisible();
  await hint.click();
  const link = page.getByRole('link', { name: 'গাইড দেখুন' });
  await expect(link).toHaveAttribute('href', /#widget\.my-pending-sections$/);
});
