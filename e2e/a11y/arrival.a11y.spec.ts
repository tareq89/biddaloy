import { adminApiSession, createGuardian, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { expectNoAxeViolations } from './assert';

/**
 * [Epic 84 follow-up] Axe scan of the student Guardians tab and the arrival lock menu.
 * They live apart from the route sweep because `/students/$studentId` is a known axe
 * failure there (`responsive/known-failures.ts`), so overlays declared on that route never
 * run. Scoped to the tab panel and the menu, so the known page-level violation is not hit.
 */
for (const locale of ['bn', 'en'] as const) {
  test.describe(`arrival guardians tab · ${locale} @sweep`, () => {
    test.use({ ...loggedIn('admin'), e2eLocale: locale });

    test('tab and lock menu have zero axe violations', async ({ page, request }) => {
      const t = makeT(locale);
      const admin = await adminApiSession(request);
      const stamp = Date.now();
      const name = `A11y Arrival Guardian ${stamp}`;
      const guardian = await createGuardian(request, admin, name, '01712345678');
      const { studentId } = await createStudentWithDues(request, admin, `A11y Arrival ${stamp}`, {
        guardianId: guardian.id,
      });
      await page.goto(`/students/${studentId}?tab=guardians`);
      const trigger = page.getByRole('button', {
        name: t('students.detail.guardians.arrival.menuLabel', { name }),
      });
      await expect(trigger).toBeVisible();
      await expectNoAxeViolations(page, '[role="tabpanel"]');
      await trigger.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      // Popper holds `animation: none` inline until the menu is positioned.
      await expect(menu).not.toHaveAttribute('style', /animation:\s*none/);
      await menu.evaluate((el) =>
        Promise.all(el.getAnimations().map((animation) => animation.finished)),
      );
      await expectNoAxeViolations(page, '[role="menu"]');
    });
  });
}
