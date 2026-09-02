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
    // ACCOUNTANT holds neither SETTINGS_MANAGE nor AUDIT_LOG_READ — both
    // ADMIN-only in `ROLE_PERMISSIONS`.
    deniedRoutes: ['/settings', '/audit-logs'],
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
    // [8.14.17]'s audit found these three actually *rendering* full data
    // for a TEACHER on direct navigation — no FEE_COLLECT, no USER_READ,
    // no INVOICE_READ.
    deniedRoutes: ['/fees/dues', '/staff', '/invoices'],
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
    // No FEE_COLLECT, no INVOICE_READ, and (deliberately) no
    // GUARDIAN_READ — see `ROLE_PERMISSIONS[EXECUTIVE]`'s own comment.
    deniedRoutes: ['/fees/dues', '/invoices', '/guardians'],
  },
];

for (const { role, visible, hidden, deniedRoutes } of CASES) {
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

    // [8.14.17]: every refusal — whatever route it's on — renders the
    // same shared `common.accessDenied.title` heading in place, not a
    // per-route string and not a redirect elsewhere.
    for (const route of deniedRoutes) {
      test(`direct visit to ${route} is refused`, async ({ page }) => {
        await page.goto(route);
        await expect(
          page.getByRole('heading', { name: t('common.accessDenied.title') }),
        ).toBeVisible();
        await expect(page).toHaveURL(route);
      });
    }
  });
}

test.describe('parent cannot reach staff routes', () => {
  test.use(loggedIn('parent'));

  test('a staff URL redirects to the portal', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/portal/);
  });
});
