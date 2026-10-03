import { adminApiSession, apiSession, createAcr, currentAcademicYearId, post } from '../api';
import { acrBody } from '../fixtures/evaluations';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';
import { SEED_PASSWORD_ENV } from '../seed-contract';

/**
 * [24.4.3] COMMITTEE journey (#1255, D9, D16, D20, D27): a School Management
 * Committee member can read the dashboard and ACRs/evaluations, and nothing else.
 * No student personal data is reachable from the UI or the API.
 *
 * Logs in as `committee@biddaloy.test` (seeded by #1368). `loggedIn()` only knows
 * the roles in `e2e/seed-contract.ts`, which is outside this ticket's territory,
 * so the login is done inline here. The ACR is created as ADMIN in its own
 * request context so it never replaces the browser's refresh cookie.
 */

const COMMITTEE_EMAIL = 'committee@biddaloy.test';
const NAV_GROUPS = [
  'people',
  'academics',
  'attendance',
  'examsResults',
  'finance',
  'reports',
  'communications',
  'administration',
];

test.beforeEach(async ({ page }) => {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: COMMITTEE_EMAIL, password },
  });
  expect(login.ok()).toBe(true);
  const { memberships } = (await login.json()) as {
    memberships: { tenantId: string; role: string }[];
  };
  const membership = memberships.find((m) => m.role === 'COMMITTEE');
  if (!membership) throw new Error('no COMMITTEE membership for the seed committee user');
  await page.addInitScript(
    ([tenant, groups]) => {
      localStorage.setItem('biddaloy:activeTenant', tenant as string);
      for (const id of groups as string[]) {
        localStorage.setItem(`nav-group-collapsed-v2:${id}`, 'false');
      }
    },
    [JSON.stringify({ tenantId: membership.tenantId, role: membership.role }), NAV_GROUPS],
  );
});

test('opens the dashboard and reads an ACR without being able to change it', async ({
  page,
  playwright,
  baseURL,
}) => {
  const suffix = crypto.randomUUID();
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  let acrId: string;
  let subjectId: string;
  try {
    const admin = await adminApiSession(ctx);
    const subject = await post<{ user: { id: string } }>(ctx, admin, '/users', {
      full_name: `Committee ACR Subject ${suffix}`,
      email: `committee-subject-${suffix}@e2e.example.com`,
      password: `E2e-Subject-${suffix}`,
      role: 'TEACHER',
      tenantId: admin.tenantId,
    });
    subjectId = subject.user.id;
    acrId = (
      await createAcr(ctx, admin, acrBody(subjectId, await currentAcademicYearId(ctx, admin)))
    ).id;
  } finally {
    await ctx.dispose();
  }

  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: t('nav.navLabel') })).toBeVisible();

  const shell = new AppShellPage(page);
  await shell.navigateTo('nav.items.evaluations');
  await expect(page).toHaveURL(/\/staff\/evaluations/);
  await expect(
    page.getByRole('heading', { name: t('evaluations.acr.register.title') }),
  ).toBeVisible();
  // The Surveys tab has no "new survey" button for a read-only role (an ADMIN sees it).
  await page.getByRole('tab', { name: t('evaluations.tabs.surveys') }).click();
  await expect(page.getByRole('heading', { name: t('evaluations.surveys.title') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('evaluations.surveys.new') })).toHaveCount(0);

  // Open the ACR itself (by URL: the register can be long) and check it is read-only.
  await page.goto(`/staff/${subjectId}/acr/${acrId}`);
  await expect(page.getByRole('heading', { name: t('evaluations.acr.title') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('evaluations.acr.submit') })).toHaveCount(0);
});

test('cannot reach students, fees, exams, settings or the collections report', async ({ page }) => {
  const shell = new AppShellPage(page);
  await page.goto('/dashboard');

  await test.step('nav has Evaluations and nothing money, student or exam related', async () => {
    await shell.expectNavItem('nav.items.dashboard', true);
    await shell.expectNavItem('nav.items.evaluations', true);
    for (const key of [
      'nav.items.students',
      'nav.items.guardians',
      'nav.items.fees',
      'nav.items.invoices',
      'nav.items.seatPlans',
      'nav.items.settings',
      // D16: the collections CSV lists student names, so the report is not granted.
      'nav.items.collectionsReport',
    ]) {
      await shell.expectNavItem(key, false);
    }
    // "Exams" is a tenant-vocabulary label, so check the link target instead.
    await expect(
      page.getByRole('navigation', { name: t('nav.navLabel') }).locator('a[href="/exams"]'),
    ).toHaveCount(0);
  });

  await test.step('Ctrl+K has no People tab (D20)', async () => {
    await page.keyboard.press('Control+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: t('nav.commandPalette.tabs.page') })).toBeVisible();
    await expect(page.getByRole('tab', { name: t('nav.commandPalette.tabs.people') })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  });

  await test.step('the API refuses student data and reports (D9, D16)', async () => {
    const committee = await apiSession(page.request, 'COMMITTEE');
    const headers = {
      Authorization: `Bearer ${committee.token}`,
      'X-Tenant-ID': committee.tenantId,
    };
    for (const path of [
      '/api/v1/students',
      '/api/v1/search?q=a',
      '/api/v1/reports/collections',
      '/api/v1/reports/collections.csv',
    ]) {
      expect((await page.request.get(path, { headers })).status(), path).toBe(403);
    }
  });

  await test.step('direct visits are refused', async () => {
    for (const route of ['/students', '/settings']) {
      await page.goto(route);
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
    }
  });
});
