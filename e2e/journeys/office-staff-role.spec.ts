import type { Page, PlaywrightWorkerArgs } from '@playwright/test';

import { adminApiSession, createClassSection, createStudent, patch, post } from '../api';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';
import { DetailShellPage } from '../pages/detail-shell';
import { FormShellPage } from '../pages/form-shell';
import { ListShellPage } from '../pages/list-shell';
import { SEED_PASSWORD_ENV } from '../seed-contract';

/**
 * [24.4.2] OFFICE_STAFF journey (#1369, D13, D16): the built-in office clerk role
 * can run intake (students, admission applicants) and print documents, and
 * nothing that moves money, changes settings or manages roles.
 *
 * Logs in as `office@biddaloy.test` (seeded by #1368). `loggedIn()` only knows the
 * roles in `e2e/seed-contract.ts`, which is outside this ticket's territory, so
 * the login is done inline here. The API sets the scene as ADMIN in its own
 * request context (so it never replaces the browser's refresh cookie); the UI
 * drives the flow under test.
 */

const OFFICE_EMAIL = 'office@biddaloy.test';
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
    data: { email: OFFICE_EMAIL, password },
  });
  expect(login.ok()).toBe(true);
  const { memberships } = (await login.json()) as {
    memberships: { tenantId: string; role: string }[];
  };
  const membership = memberships.find((m) => m.role === 'OFFICE_STAFF');
  if (!membership) throw new Error('no OFFICE_STAFF membership for the seed office user');
  await page.addInitScript(
    ([tenant, groups]) => {
      localStorage.setItem('biddaloy:activeTenant', tenant as string);
      for (const id of groups as string[])
        localStorage.setItem(`nav-group-collapsed-v2:${id}`, 'false');
    },
    [JSON.stringify({ tenantId: membership.tenantId, role: membership.role }), NAV_GROUPS],
  );
});

/** ADMIN session on a throwaway request context. */
async function adminScene(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
) {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  return { ctx, session: await adminApiSession(ctx) };
}

test('adds a student', async ({ page, playwright, baseURL }) => {
  const { ctx, session } = await adminScene(playwright, baseURL);
  try {
    await createClassSection(ctx, session);
  } finally {
    await ctx.dispose();
  }
  const form = new FormShellPage(page);
  const name = `Office Admission ${Date.now()}`;

  await page.goto('/students/new');
  await form.fillField('students.form.fields.fullName', name);
  await page.getByLabel(t('students.form.fields.class')).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t('students.form.fields.section')).click();
  await page.getByRole('option').first().click();
  await form.submit('students.new.submitAction');
  await new DetailShellPage(page).expectLoaded(name);
});

test('reviews an admission applicant', async ({ page, playwright, baseURL }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const applicantName = `Office Applicant ${suffix}`;
  const { ctx, session } = await adminScene(playwright, baseURL);
  try {
    const section = await createClassSection(ctx, session);
    const intake = await post<{ id: string }>(ctx, session, '/admission-intakes', {
      title: `Office Intake ${suffix}`,
      class_section_id: section.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: [],
    });
    // The public form is covered by `admission.spec.ts`; submit over the public API here.
    const submit = await ctx.post('/api/v1/public/admission/default-school/applicants', {
      multipart: {
        intake_id: intake.id,
        applicant_name: applicantName,
        date_of_birth: '2018-06-01',
        gender: 'MALE',
        guardian_name: `Guardian of ${applicantName}`,
        guardian_phone: `1${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`,
      },
    });
    expect(submit.ok()).toBe(true);
  } finally {
    await ctx.dispose();
  }

  const list = new ListShellPage(page, { titleKey: 'admission-staff-applicants.list.title' });
  await page.goto('/admissions/applicants');
  await list.expectLoaded();
  await list.openRowByText(applicantName);
  const detail = new DetailShellPage(page);
  await detail.expectLoaded(applicantName);
  await detail.clickAction('admission-staff-applicants.detail.actionShortlist');
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(t('admission-staff-applicants.evaluate.notesLabel'))
    .fill('Office review.');
  await dialog.getByRole('button', { name: t('admission-staff-applicants.evaluate.save') }).click();
  await expect(dialog).toBeHidden();
});

test('prints a student ID card', async ({ page, playwright, baseURL }) => {
  const suffix = `${Date.now()}`;
  const templateName = `Office Print ${suffix}`;
  const printerName = `Office Printer ${suffix}`;
  const { ctx, session } = await adminScene(playwright, baseURL);
  let studentId: string;
  try {
    // Published but NOT made the default: `print-id-cards.spec.ts` owns the default template.
    const template = await post<{ id: string }>(ctx, session, '/print-templates', {
      name: templateName,
      suggestion_key: 'student-landscape-modern',
    });
    await patch(ctx, session, `/print-templates/${template.id}`, { batch_size: 2 });
    await post(ctx, session, `/print-templates/${template.id}/publish`, {});
    await post(ctx, session, '/printers', { name: printerName, printer_type: 'OFFICE' });
    studentId = (await createStudent(ctx, session, `Office Print ${suffix}`)).id;
  } finally {
    await ctx.dispose();
  }

  await stubPrintWindow(page);
  await page.goto(`/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT&ids=${studentId}`);
  await page.getByRole('combobox', { name: t('printPreview.controls.template') }).click();
  await page.getByRole('option', { name: new RegExp(templateName) }).click();
  await page.getByRole('combobox', { name: t('printPreview.controls.printer') }).click();
  await page.getByRole('option', { name: new RegExp(printerName) }).click();
  // No photo on this student: the preview asks for an explicit "print anyway".
  await page.getByRole('checkbox', { name: t('printPreview.preflight.printAnyway') }).check();
  await page.getByRole('button', { name: t('printPreview.print'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __printHtml: string[] }).__printHtml.length),
    )
    .toBeGreaterThan(0);
});

test('cannot reach money, settings or roles', async ({ page }) => {
  const shell = new AppShellPage(page);
  await page.goto('/dashboard');

  await test.step('nav keeps intake, hides Payments, Settings, Audit log and Roles', async () => {
    await shell.expectNavItem('nav.items.students', true);
    await shell.expectNavItem('nav.items.admissionApplicants', true);
    for (const key of [
      'nav.items.recordPayment',
      'nav.items.studentDues',
      'nav.items.settings',
      'nav.items.auditLogs',
      'nav.items.rolesAccess',
    ]) {
      await shell.expectNavItem(key, false);
    }
  });

  await test.step('Ctrl+K finds pages the role has, but not Roles (no USER_READ)', async () => {
    await shell.openGlobalSearch();
    await shell.switchToPageTab();
    await shell.searchFor(t('nav.items.admissionApplicants'));
    await expect(
      page.getByRole('option', { name: t('nav.items.admissionApplicants') }),
    ).toBeVisible();
    await shell.searchFor(t('nav.items.rolesAccess'));
    await expect(page.getByRole('option', { name: t('nav.items.rolesAccess') })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  await test.step('direct visits to Settings and Roles are refused', async () => {
    for (const route of ['/settings', '/roles']) {
      await page.goto(route);
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
    }
  });
});

/** `window.open` is stubbed (a real print window can't be driven); the HTML that
 * would have been printed is captured on `window.__printHtml`. */
async function stubPrintWindow(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printHtml: string[] };
    w.__printHtml = [];
    const realCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === 'text/html') {
        void obj.text().then((html) => w.__printHtml.push(html));
      }
      return realCreate(obj);
    };
    window.open = (() => ({
      opener: null,
      location: { href: '' },
      print: () => undefined,
      close: () => undefined,
    })) as unknown as typeof window.open;
  });
}
