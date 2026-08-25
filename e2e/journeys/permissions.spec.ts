import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

/**
 * [8.5.7] Journey 3: permission-gated navigation, parameterized over the
 * role fixtures. Expected sidebar visibility comes from
 * `shared/src/enums/permissions.ts` (ROLE_PERMISSIONS) mapped through
 * `_staff.tsx`'s navGroups. A forbidden direct visit renders the route's
 * access-denied state (`/settings`) — client-side gating is a UX nicety;
 * the server is the real boundary (see `_staff.tsx`'s own comment).
 */

const CASES = [
  {
    role: 'accountant' as const,
    visible: [
      'nav.items.students',
      'nav.items.guardians',
      'nav.items.studentDues',
      'nav.items.recordPayment',
      'nav.items.fees',
      'nav.items.feeStructures',
      'nav.items.invoices',
    ],
    hidden: ['nav.items.academicYears', 'nav.items.classes', 'nav.items.settings'],
  },
  {
    // Dues/record-payment are gated on FEE_COLLECT/PAYMENT_RECORD, not
    // FEE_READ — teachers hold FEE_READ for read-only context only
    // (see _staff.tsx's navGroups comment).
    role: 'teacher' as const,
    visible: ['nav.items.students', 'nav.items.guardians'],
    hidden: [
      'nav.items.studentDues',
      'nav.items.recordPayment',
      'nav.items.fees',
      'nav.items.feeStructures',
      'nav.items.invoices',
      'nav.items.settings',
      'nav.items.academicYears',
      'nav.items.classes',
    ],
  },
  {
    role: 'executive' as const,
    visible: ['nav.items.students'],
    hidden: [
      'nav.items.guardians',
      'nav.items.studentDues',
      'nav.items.recordPayment',
      'nav.items.fees',
      'nav.items.feeStructures',
      'nav.items.invoices',
      'nav.items.settings',
      'nav.items.academicYears',
      'nav.items.classes',
    ],
  },
];

for (const { role, visible, hidden } of CASES) {
  test.describe(`${role} navigation`, () => {
    test.use(loggedIn(role));

    test(`sidebar shows only permitted sections`, async ({ page }) => {
      const shell = new AppShellPage(page);
      await page.goto('/dashboard');
      for (const key of visible) {
        await test.step(`shows ${key}`, () => shell.expectNavItem(key, true));
      }
      for (const key of hidden) {
        await test.step(`hides ${key}`, () => shell.expectNavItem(key, false));
      }
    });

    test(`direct visit to /settings is refused`, async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: t('settings.accessDenied') })).toBeVisible();
    });
  });
}

test.describe('parent cannot reach staff routes', () => {
  test.use(loggedIn('parent'));

  test('a staff URL redirects to the portal', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/portal/);
  });
});
