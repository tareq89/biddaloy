import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, get, post, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { fileStudentLeave, uniqueLeaveDay } from '../responsive/routes';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';

// [52.5.8] The staff Applications screens, end to end: file a leave and see the balance move,
// bulk approve (never a fee waiver), the reports page, the student tab, and the old route gone.

interface ListItem {
  id: string;
  serial: string;
  type: string;
  subject_student_id: string | null;
  can: { decide: boolean };
}

async function roleSession(request: APIRequestContext, role: SeedRole): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS[role], password },
  });
  if (!response.ok()) throw new Error(`${role} login failed: ${response.status()}`);
  const body = (await response.json()) as {
    access_token: string;
    memberships: { tenantId: string }[];
  };
  return { token: body.access_token, tenantId: body.memberships[0]!.tenantId };
}

/** Opens the kit DatePicker named `label` and picks `iso` (same pattern as `admission.spec.ts`). */
async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  await page.getByRole('button', { name: label }).click();
  await page.locator(`[data-date="${iso}"]`).click();
  // The closing popover of the first field must be gone before the second one opens.
  await expect(page.getByRole('grid')).toHaveCount(0);
}

function nextWeekdays(): [string, string] {
  // The Monday and Tuesday of next week: working days under the school's Friday/Saturday weekend.
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const monday = iso(d);
  d.setDate(d.getDate() + 1);
  return [monday, iso(d)];
}

const rowFor = (page: Page, serial: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: `আবেদন ${serial} খুলুন` }) });

test.describe.serial('staff leave: file -> approve -> balance moves', () => {
  let applicationId: string;
  let balanceBefore: number;
  let staffProfileId: string;

  test.describe('1. admin files a casual leave', () => {
    test.use(loggedIn('admin'));

    test('Ctrl+K action opens the form at step 2; submit lands on the detail', async ({
      page,
      request,
    }) => {
      const session = await adminApiSession(request);
      const me = await get<{ staff_profile_id: string | null }>(request, session, '/users/me');
      if (!me.staff_profile_id) throw new Error('seed admin has no staff profile');
      staffProfileId = me.staff_profile_id;
      const balances = await get<{ leave_type: string; balance: number | null }[]>(
        request,
        session,
        `/leave/balance?staff_profile_id=${staffProfileId}`,
      );
      const casual = balances.find((b) => b.leave_type === 'CASUAL');
      // The seed gives CASUAL a quota; null would mean "unlimited" and nothing could move.
      expect(casual?.balance).not.toBeNull();
      balanceBefore = casual!.balance!;

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(
        page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
      ).toBeFocused();
      await page.keyboard.press('Control+3'); // Action tab
      await page.keyboard.type('ছুটির আবেদন করুন');
      await expect(page.getByRole('option').first()).toBeVisible();
      // The form re-renders when the balance hint arrives; a picker opened before then is replaced.
      const balanceLoaded = page.waitForResponse(
        (r) => r.url().includes('/leave/balance') && r.ok(),
      );
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/applications\/new\?type=STAFF_LEAVE/);
      await balanceLoaded;

      const [start, end] = nextWeekdays();
      await page.getByRole('combobox', { name: t('applicationForms.fields.leaveType') }).click();
      await page.getByRole('option', { name: t('leave.type.CASUAL') }).click();
      await pickDate(page, t('applicationForms.fields.startDate'), start);
      await pickDate(page, t('applicationForms.fields.endDate'), end);
      await page.getByLabel(t('applicationForms.fields.reason')).fill('E2E পারিবারিক কাজ');
      const next = page.getByRole('button', { name: t('applicationsNew.actions.next') });
      await next.click(); // details -> addressee
      await next.click(); // -> attachments
      await next.click(); // -> letter preview
      await page.getByRole('button', { name: t('applicationsNew.actions.submit') }).click();

      await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
      applicationId = page.url().split('/').pop()!;
      await expect(page.getByText(t('applications.statuses.PENDING')).first()).toBeVisible();
      const created = await get<{ serial: string }>(
        request,
        session,
        `/applications/${applicationId}`,
      );
      await expect(page.getByText(created.serial).first()).toBeVisible();
      // A15: nobody decides their own application.
      await expect(
        page.getByRole('button', { name: t('applicationsDetail.actions.approve') }),
      ).toHaveCount(0);
    });
  });

  test.describe('2. executive approves it', () => {
    test.use(loggedIn('executive'));

    test('the detail page shows Approve and the status becomes approved', async ({ page }) => {
      await page.goto(`/applications/${applicationId}`);
      await page.getByRole('button', { name: t('applicationsDetail.actions.approve') }).click();
      await page
        .getByRole('button', { name: t('applicationsDetail.dialogs.approve.submit') })
        .click();
      await expect(page.getByText(t('applications.statuses.APPROVED')).first()).toBeVisible();
    });
  });

  test.describe('3. admin sees the balance drop', () => {
    test.use(loggedIn('admin'));

    test('balance fell by the approved working days', async ({ request }) => {
      const session = await adminApiSession(request);
      const app = await get<{ status: string; effect_result: { days: number } | null }>(
        request,
        session,
        `/applications/${applicationId}`,
      );
      expect(app.status).toBe('APPROVED');
      const days = app.effect_result?.days ?? 0;
      expect(days).toBeGreaterThan(0);
      const balances = await get<{ leave_type: string; balance: number }[]>(
        request,
        session,
        `/leave/balance?staff_profile_id=${staffProfileId}`,
      );
      expect(balances.find((b) => b.leave_type === 'CASUAL')?.balance).toBe(balanceBefore - days);
    });
  });
});

test.describe('bulk approve (teacher)', () => {
  test.use(loggedIn('teacher'));

  test('approves 3 leaves, skips the fee waiver, and says so', async ({ page, request }) => {
    // Own rows, so parallel shards never consume each other's: filed for a student in the
    // teacher's section (found from the teacher's own inbox) as paper entries by the admin.
    const teacher = await roleSession(request, 'teacher');
    const admin = await adminApiSession(request);
    const inbox = await get<{ data: ListItem[] }>(request, teacher, '/applications?view=inbox');
    const studentId = inbox.data.find((a) => a.subject_student_id)?.subject_student_id;
    if (!studentId) throw new Error('teacher inbox has no student application (seed)');
    // Distinct random working days: approving one must never overlap another of the same student.
    const days = new Set<string>();
    while (days.size < 3) days.add(uniqueLeaveDay());
    const leaves = [];
    for (const day of days) leaves.push(await fileStudentLeave(request, admin, studentId, day));
    const waiver = await post<{ serial: string }>(request, admin, '/applications', {
      type: 'FEE_WAIVER',
      subject_student_id: studentId,
      applicant_name: 'E2E অভিভাবক',
      payload: { kind: 'FLAT', value: 200, reason: 'E2E' },
    });

    await page.goto('/applications?view=inbox');
    for (const { serial } of [...leaves, waiver]) {
      await rowFor(page, serial).getByRole('checkbox').check();
    }
    await page.getByRole('button', { name: t('applicationsList.bulk.approve') }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog).toContainText(t('applicationsList.bulk.confirmBodyExcluded', { n: 1 }));
    const [request3] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/applications/bulk-approve')),
      dialog.getByRole('button', { name: t('applicationsList.bulk.confirm') }).click(),
    ]);
    expect((request3.postDataJSON() as { ids: string[] }).ids).toHaveLength(3);
    await expect(
      page.getByText(t('applicationsList.bulk.resultTitle', { total: 3, ok: 3 })),
    ).toBeVisible();
    // The fee waiver needs its own look (D35): still waiting in the inbox.
    await expect(rowFor(page, waiver.serial)).toBeVisible();
  });
});

test.describe('reports', () => {
  test.describe('admin', () => {
    test.use(loggedIn('admin'));

    test('header link opens the report; a stale testimonial is listed', async ({ page }) => {
      await page.goto('/applications');
      // Scoped to the page: the sidebar has a "Reports" group button of the same name.
      await page
        .locator('#main-content')
        .getByRole('button', { name: t('applicationsList.actions.reports') })
        .click();
      await expect(page).toHaveURL(/\/applications\/reports/);
      await expect(
        page.getByRole('heading', { level: 1, name: t('nav.items.applicationsReportsNav') }),
      ).toBeVisible();
      await expect(page.getByLabel(t('applicationsReports.tilesLabel'))).toBeVisible();
      const crumbs = page.locator('[data-slot="breadcrumbs"]');
      await expect(crumbs).toContainText(t('nav.items.applications'));
      await expect(crumbs).toContainText(t('nav.items.applicationsReports'));
      const stale = page.getByRole('region', { name: t('applicationsReports.staleTitle') });
      await expect(
        stale
          .getByRole('row')
          .filter({ hasText: t('applications.types.TESTIMONIAL') })
          .first(),
      ).toBeVisible();
    });
  });

  test.describe('teacher', () => {
    test.use(loggedIn('teacher'));

    test('has no header link and the report is refused', async ({ page }) => {
      await page.goto('/applications');
      await expect(
        page.getByRole('heading', { level: 1, name: t('nav.items.applications') }),
      ).toBeVisible();
      await expect(
        page
          .locator('#main-content')
          .getByRole('button', { name: t('applicationsList.actions.reports') }),
      ).toHaveCount(0);
      await page.goto('/applications/reports');
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
      await expect(page.getByLabel(t('applicationsReports.tilesLabel'))).toHaveCount(0);
    });
  });
});

test.describe('student tab and the retired route (admin)', () => {
  test.use(loggedIn('admin'));

  test('the student page lists their applications; the eye opens one', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const all = await get<{ data: ListItem[] }>(request, admin, '/applications?view=all');
    const row = all.data.find((a) => a.subject_student_id);
    if (!row) throw new Error('no student application seeded');
    await page.goto(`/students/${row.subject_student_id}?tab=applications`);
    const open = page.locator(`a[href$="/applications/${row.id}"]`).first();
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/applications/${row.id}$`));
  });

  test('POST /leave/requests is gone (D20)', async ({ request }) => {
    const admin = await adminApiSession(request);
    const response = await request.post('/api/v1/leave/requests', {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
      data: {},
    });
    expect(response.status()).toBe(404);
  });
});
