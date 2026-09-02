import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.14.3] Staff bottom navigation below `md`: a 5-cell bar (4
 * permission-gated destinations + `more`), safe-area-aware padding, and a
 * single consolidated mobile header row — replacing the old two-stacked-
 * bars shape. Model: `e2e/responsive/drawer.spec.ts`'s `t()` usage and
 * fixture shape; roles come from `../seed-contract`.
 */

test.describe('staff bottom nav', () => {
  test.use({ ...loggedIn('admin'), viewport: { width: 320, height: 900 } });

  test('renders a named 5-cell bar with ≥44×44 cells, and marks the active route', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') });
    await expect(nav).toBeVisible();

    const cells = nav.locator('a, button');
    await expect(cells).toHaveCount(5);
    for (const cell of await cells.all()) {
      const box = await cell.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await expect(page.getByRole('link', { name: t('nav.items.dashboard') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('More opens the drawer, Escape closes it, and focus returns to a real on-screen control', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const more = page.getByRole('button', { name: t('nav.items.more') });

    await more.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // [8.14.3] real-behavior note (pinned by `app-shell.test.tsx`'s own
    // '8.14.3' describe block): Radix's `DialogTrigger` hardcodes itself as
    // the focus-restore target regardless of what element actually opened
    // the dialog. `more` opens the drawer through `useAppShellDrawer`
    // rather than through `DialogTrigger` itself, so focus lands back on
    // the mobile header's own hamburger ("Open menu"), not on `more`. Still
    // a real, on-screen, interactive element — not a lost-focus regression.
    await expect(page.getByRole('button', { name: t('nav.openMenuLabel') })).toBeFocused();
  });

  test('exactly one chrome row is visible below md — the tenant/role row is hidden', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') }),
    ).toBeVisible();
    await expect(page.locator('[data-app-header-row]')).toBeHidden();
  });

  test.describe('at 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the bar still renders exactly 5 cells', async ({ page }) => {
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') });
      await expect(nav.locator('a, button')).toHaveCount(5);
    });
  });

  test.describe('TEACHER', () => {
    test.use(loggedIn('teacher'));

    test('has no Student Dues / Record Payment cells, and still ≤5 cells total', async ({
      page,
    }) => {
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: t('nav.items.studentDues') })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: t('nav.items.recordPayment') })).toHaveCount(0);
      const count = await nav.locator('a, button').count();
      expect(count).toBeLessThanOrEqual(5);
    });
  });

  test.describe('at desktop width (1280px)', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the bottom nav is not visible, and the tenant row is', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(
        page.getByRole('navigation', { name: t('nav.bottomNavStaffLabel') }),
      ).toBeHidden();
      await expect(page.locator('[data-app-header-row]')).toBeVisible();
    });
  });
});

test.describe('portal regression', () => {
  test.use({ ...loggedIn('parent'), viewport: { width: 320, height: 900 } });

  test('parent (guardian portal) at 320px still has no button named openMenuLabel', async ({
    page,
  }) => {
    await page.goto('/portal');
    await expect(page.getByRole('button', { name: t('nav.openMenuLabel') })).toHaveCount(0);
  });
});
