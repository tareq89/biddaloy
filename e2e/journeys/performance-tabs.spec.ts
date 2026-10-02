import {
  adminApiSession,
  createClassSection,
  get,
  parentApiSession,
  createTeacherForSection,
  type ApiSession,
} from '../api';
import { expectNoAxeViolations } from '../a11y/assert';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.4.8] Performance tabs on a 375px phone (D13, D22, D18):
 *  - admin: the student and staff Performance tabs render, fit the screen and
 *    pass axe (scoped to `main`; the shell-wide sidebar/breadcrumb axe debt is
 *    tracked separately);
 *  - teacher: sees the student Performance tab (MARK_VIEW) but never staff
 *    Performance (needs ACR_READ + USER_READ): the page is denied and the API
 *    answers 401.
 */
const PHONE = { width: 375, height: 812 };

async function expectFitsPhone(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('admin', () => {
  test.use({ ...loggedIn('admin'), viewport: PHONE });

  test('student and staff Performance tabs fit a phone and pass axe', async ({ page, request }) => {
    const session = await adminApiSession(request);
    // A student enrolled in the CURRENT year (the seeded parent's child): a student
    // with no enrollment there makes the API 404 and the tab shows its error state.
    const parent = await parentApiSession(request);
    const [student] = await get<{ id: string }[]>(request, parent, '/students/mine');
    const chain = await createClassSection(request, session);
    const staff = await createTeacherForSection(
      request,
      session,
      `Perf Staff ${Date.now()}`,
      chain.sectionId,
    );

    await test.step('student tab', async () => {
      await page.goto(`/students/${student!.id}?tab=performance`);
      await expect(
        page.getByRole('tab', { name: t('performance.title'), exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText(t('performance.notEnoughData')).first()).toBeVisible();
      await expectFitsPhone(page);
      await expectNoAxeViolations(page, 'main');
    });

    await test.step('staff tab: sealed survey shows the waiting line, not a number', async () => {
      await page.goto(`/staff/${staff.userId}?tab=performance`);
      await expect(page.getByText(t('performance.surveyWaiting')).first()).toBeVisible();
      await expectFitsPhone(page);
      await expectNoAxeViolations(page, 'main');
    });
  });
});

test.describe('teacher', () => {
  test.use({ ...loggedIn('teacher'), viewport: PHONE });

  test('sees student Performance but not staff Performance', async ({ page, request }) => {
    const admin = await adminApiSession(request);
    const chain = await createClassSection(request, admin);
    const staff = await createTeacherForSection(
      request,
      admin,
      `Perf Hidden ${Date.now()}`,
      chain.sectionId,
    );

    await test.step('a student detail has the Performance tab', async () => {
      await page.goto('/students');
      await page.getByRole('link', { name: /.+/, includeHidden: false }).first().waitFor();
      await page.locator('main a[href^="/students/"]').first().click();
      await expect(
        page.getByRole('tab', { name: t('performance.title'), exact: true }),
      ).toBeVisible();
    });

    await test.step('staff detail is denied', async () => {
      await page.goto(`/staff/${staff.userId}?tab=performance`);
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('tab', { name: t('performance.title'), exact: true }),
      ).toHaveCount(0);
    });

    await test.step('the staff Performance API answers 401', async () => {
      const password = process.env[SEED_PASSWORD_ENV];
      const login = await request.post('/api/v1/auth/login', {
        data: { email: SEED_ROLE_EMAILS.teacher, password },
      });
      const body = (await login.json()) as {
        access_token: string;
        memberships: { tenantId: string; role: string }[];
      };
      const session: ApiSession = {
        token: body.access_token,
        tenantId: body.memberships.find((m) => m.role === 'TEACHER')!.tenantId,
      };
      const res = await request.get(`/api/v1/performance/staff/${staff.userId}`, {
        headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      });
      expect(res.status()).toBe(401);
    });
  });
});
