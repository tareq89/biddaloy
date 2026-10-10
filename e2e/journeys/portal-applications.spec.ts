import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, get, parentApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { freeLeaveDays } from '../responsive/routes';

// [52.6.4] The guardian/student portal Applications pages, end to end: see the seeded cards, file
// a leave with a PDF, follow it, comment, have the class teacher approve it, withdraw a second
// one, never see decide actions, and never read another family's application.

const ONE_PAGE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R/Size 4>>\n%%EOF\n',
);

/**
 * Opens the kit DatePicker named `label` and picks `iso`, paging months until it is on screen.
 * The free days are in Jan-Feb, so this pages back several months. Retried as a whole, reopening
 * the picker, like `journeys/applications.spec.ts`: CI has seen the popover dismissed right after
 * it opened (a button or cell "not stable", then detached).
 */
async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  const grid = page.getByRole('grid');
  const cell = page.locator(`[role="grid"] [data-date="${iso}"]`);
  await expect(async () => {
    if (!(await grid.isVisible())) await page.getByRole('button', { name: label }).click();
    for (let i = 0; i < 24 && !(await cell.isVisible()); i += 1) {
      // A mid-grid cell always belongs to the shown month, so it says which way the target lies.
      const shown = await grid.locator('[data-date]').nth(15).getAttribute('data-date');
      const key = (shown ?? iso) > iso ? 'common.date.previousMonth' : 'common.date.nextMonth';
      await page.getByRole('button', { name: t(key) }).click({ timeout: 3_000 });
    }
    await cell.click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  // The closing popover of the first field must be gone before the second one opens.
  await expect(grid).toHaveCount(0);
}

/** From the list: "New application" -> STUDENT_LEAVE -> fill the details -> Next (to attachments). */
async function fillLeaveDetails(page: Page, day: string, details: string): Promise<void> {
  await page.getByRole('link', { name: t('portalApplications.newApplication') }).click();
  await page
    .getByRole('radio', { name: new RegExp(t('applications.types.STUDENT_LEAVE')) })
    .check();
  await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click();
  await page.getByRole('combobox', { name: t('applicationForms.fields.reasonKind') }).click();
  await page.getByRole('option', { name: t('applications.reasons.SICK') }).click();
  await pickDate(page, t('applicationForms.fields.startDate'), day);
  await pickDate(page, t('applicationForms.fields.endDate'), day);
  await page.getByLabel(t('applicationForms.fields.details')).fill(details);
  await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click();
}

async function openFromPortalNav(page: Page): Promise<void> {
  await page.goto('/portal');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: t('nav.items.portalApplications') })
    .first()
    .click();
  await expect(page).toHaveURL(/\/portal\/applications/);
  await expect(
    page.getByRole('heading', { level: 1, name: t('portalApplications.title') }),
  ).toBeVisible();
}

/**
 * The seeded family has four children and the list opens on the first; the seeded cards belong
 * to the child the student login is linked to, the one on the card the student filed.
 */
async function seededChildId(request: APIRequestContext): Promise<string> {
  const parent = await parentApiSession(request);
  const mine = await get<{ data: { applicant_name: string; subject_student_id: string }[] }>(
    request,
    parent,
    '/applications?view=mine&limit=100',
  );
  const child = mine.data.find((a) => a.applicant_name === 'Student User')?.subject_student_id;
  if (!child) throw new Error('no application filed by the seeded student (seed)');
  return child;
}

async function openSeededChild(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto(`/portal/applications?student=${await seededChildId(request)}`);
  await expect(
    page.getByRole('heading', { level: 1, name: t('portalApplications.title') }),
  ).toBeVisible();
}

const cards = (page: Page) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2 }) });

test.describe.serial('guardian: file, follow, comment, withdraw', () => {
  let filedId: string;
  // Two free past school days for the child (the teacher approves the first): see `freeLeaveDays`.
  let days: string[];

  test.describe('1. parent', () => {
    test.use(loggedIn('parent'));

    test('the list shows the seeded cards, including the student-filed and the paper one', async ({
      page,
      request,
    }) => {
      await openFromPortalNav(page);
      await openSeededChild(page, request);
      // The leave the guardian filed, still waiting.
      await expect(
        cards(page)
          .filter({ hasText: t('applications.statuses.PENDING') })
          .filter({ hasText: t('portalApplications.filed.self') })
          .first(),
      ).toBeVisible();
      // The leave the student filed and the class teacher approved (D43): the guardian sees it.
      await expect(
        cards(page)
          .filter({ hasText: t('applications.statuses.APPROVED') })
          .filter({ hasText: 'Student User' })
          .first(),
      ).toBeVisible();
      // The rejected testimonial.
      await expect(
        cards(page)
          .filter({ hasText: t('applications.statuses.REJECTED') })
          .filter({ hasText: t('applications.types.TESTIMONIAL') })
          .first(),
      ).toBeVisible();
      // The paper entry the office made on the guardian's behalf.
      await expect(
        cards(page)
          .filter({ hasText: t('portalApplications.filed.paper') })
          .first(),
      ).toBeVisible();
    });

    test('files a leave with a PDF, then comments on it', async ({ page, request }) => {
      days = await freeLeaveDays(
        request,
        await adminApiSession(request),
        await seededChildId(request),
        2,
        // February: the staff specs take January for the same seeded child (see `freeLeaveDays`).
        { from: '2026-02-01', to: '2026-02-28' },
      );
      await openSeededChild(page, request);
      await fillLeaveDetails(page, days[0]!, 'E2E জ্বর');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'doctor-note.pdf',
        mimeType: 'application/pdf',
        buffer: ONE_PAGE_PDF,
      });
      await expect(page.getByText('doctor-note.pdf')).toBeVisible();
      await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click();
      // The server-written letter is the preview.
      await expect(
        page.getByRole('heading', { name: t('portalApplications.new.steps.preview') }),
      ).toBeVisible();
      await expect(page.getByText(t('applications.types.STUDENT_LEAVE')).first()).toBeVisible();
      await page.getByRole('button', { name: t('portalApplications.new.actions.submit') }).click();

      await expect(page).toHaveURL(/\/portal\/applications\/[0-9a-f-]{36}$/);
      filedId = page.url().split('/').pop()!;
      await expect(page.getByText(t('applications.statuses.PENDING')).first()).toBeVisible();
      await expect(page.getByText('doctor-note.pdf').first()).toBeVisible();

      await page
        .getByLabel(t('applicationsDetail.activity.commentLabel'))
        .fill('ডাক্তারের কাগজ যুক্ত করেছি');
      await page
        .getByRole('button', { name: t('applicationsDetail.activity.commentSend') })
        .click();
      await expect(page.getByText('ডাক্তারের কাগজ যুক্ত করেছি')).toBeVisible();

      // A family never decides or tags, whatever the API says.
      for (const action of ['approve', 'reject', 'consider', 'cancel'] as const) {
        await expect(
          page.getByRole('button', { name: t(`applicationsDetail.actions.${action}`) }),
        ).toHaveCount(0);
      }
      await expect(
        page.getByRole('button', { name: t('applicationsDetail.activity.addTags') }),
      ).toHaveCount(0);
    });
  });

  test.describe('2. class teacher approves it', () => {
    test.use(loggedIn('teacher'));

    test('the detail page takes Approve', async ({ page }) => {
      await page.goto(`/applications/${filedId}`);
      await page.getByRole('button', { name: t('applicationsDetail.actions.approve') }).click();
      await page
        .getByRole('button', { name: t('applicationsDetail.dialogs.approve.submit') })
        .click();
      await expect(page.getByText(t('applications.statuses.APPROVED')).first()).toBeVisible();
    });
  });

  test.describe('3. parent follows the decision, withdraws a second one', () => {
    test.use(loggedIn('parent'));

    test('the detail shows approved after a reload', async ({ page }) => {
      await page.goto(`/portal/applications/${filedId}`);
      await page.reload();
      await expect(page.getByText(t('applications.statuses.APPROVED')).first()).toBeVisible();
    });

    test('files another and withdraws it', async ({ page, request }) => {
      await openSeededChild(page, request);
      await fillLeaveDetails(page, days[1]!, 'E2E আবার');
      await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click(); // attachments -> letter
      await page.getByRole('button', { name: t('portalApplications.new.actions.submit') }).click();
      await expect(page).toHaveURL(/\/portal\/applications\/[0-9a-f-]{36}$/);

      await page.getByRole('button', { name: t('applicationsDetail.actions.withdraw') }).click();
      await page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'))
        .getByRole('button', { name: t('applicationsDetail.dialogs.withdraw.confirm') })
        .click();
      await expect(page.getByText(t('applications.statuses.WITHDRAWN')).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('applicationsDetail.actions.withdraw') }),
      ).toHaveCount(0);
    });

    test("another family's application is a 404", async ({ request }) => {
      const parent = await parentApiSession(request);
      const mine = await get<{ data: { id: string }[] }>(
        request,
        parent,
        '/applications?view=mine&limit=100',
      );
      const mineIds = new Set(mine.data.map((a) => a.id));
      const admin = await adminApiSession(request);
      const all = await get<{ data: { id: string; subject_student_id: string | null }[] }>(
        request,
        admin,
        '/applications?view=all&limit=100',
      );
      // A student application of another family, not a staff one (that would prove nothing).
      const foreign = all.data.find((a) => a.subject_student_id && !mineIds.has(a.id));
      if (!foreign) throw new Error('no application outside the parent family (seed)');
      const response = await request.get(`/api/v1/applications/${foreign.id}`, {
        headers: { Authorization: `Bearer ${parent.token}`, 'X-Tenant-ID': parent.tenantId },
      });
      expect(response.status()).toBe(404);
    });
  });
});

test.describe('student: files a general application to the class teacher', () => {
  test.use(loggedIn('student'));

  test('the request body carries addressee CLASS_TEACHER', async ({ page }) => {
    await openFromPortalNav(page);
    // Only their own record: no child picker (a guardian with several children gets one).
    await expect(page.getByRole('navigation', { name: t('portal.fees.pickerLabel') })).toHaveCount(
      0,
    );
    await expect(
      cards(page)
        .filter({ hasText: t('portalApplications.filed.self') })
        .filter({ hasText: t('applications.statuses.APPROVED') })
        .first(),
    ).toBeVisible();
    await page.getByRole('link', { name: t('portalApplications.newApplication') }).click();
    await page.getByRole('radio', { name: new RegExp(t('applications.types.GENERAL')) }).check();
    await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click();
    await page.getByRole('radio', { name: t('applications.addressees.CLASS_TEACHER') }).check();
    await page.getByLabel(t('applicationForms.fields.subjectLine')).fill('E2E বিষয়');
    await page.getByLabel(t('applicationForms.fields.body')).fill('E2E বক্তব্য');
    await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click(); // details -> attachments
    await page.getByRole('button', { name: t('portalApplications.new.actions.next') }).click(); // -> letter
    const [posted] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && /\/api\/v1\/applications$/.test(r.url())),
      page.getByRole('button', { name: t('portalApplications.new.actions.submit') }).click(),
    ]);
    expect((posted.postDataJSON() as { addressee: string }).addressee).toBe('CLASS_TEACHER');
    await expect(page).toHaveURL(/\/portal\/applications\/[0-9a-f-]{36}$/);
  });
});
