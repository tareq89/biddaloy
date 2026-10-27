import { expect, loggedIn, test } from './fixtures/test';
import { expectNoAxeViolations } from './a11y/assert';

/**
 * [44.2.03] In-app help (?) end to end: keyboard, phone, F1, palette, widget, axe.
 * The base URL is the one `ci.yml` builds client-admin with (`VITE_HANDBOOK_URL`, E12).
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
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });

  test('keyboard: Tab to the (?), Enter opens, Tab reaches the guide link, Esc returns focus', async ({
    page,
  }) => {
    const hint = page.locator(PAGE_HELP);
    await expect(hint).toHaveAttribute('aria-label', /^সাহায্য:/);

    await page.getByRole('heading', { level: 1 }).first().focus();
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

  test('F1 opens the guide page; F1 inside the date input does nothing', async ({ page }) => {
    const opened = () =>
      page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

    await page.locator('input[type="date"]').first().focus();
    await page.keyboard.press('F1');
    expect(await opened()).toEqual([]);

    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('F1');
    await expect.poll(opened).toEqual([GUIDE]);
  });

  test('Ctrl+K lists "এই পাতার সাহায্য"', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('option', { name: 'এই পাতার সাহায্য' })).toBeVisible();
  });

  test('phone: a tap opens the card inside the viewport with no horizontal scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/attendance');
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

test('dashboard: a widget (?) links to its anchor in the guide', async ({ page }) => {
  await page.goto('/dashboard');
  const hint = page.locator('button[data-help-id="widget.my-pending-sections"]');
  await expect(hint).toBeVisible();
  await hint.click();
  const link = page.getByRole('link', { name: 'গাইড দেখুন' });
  await expect(link).toHaveAttribute('href', /#widget\.my-pending-sections$/);
});
