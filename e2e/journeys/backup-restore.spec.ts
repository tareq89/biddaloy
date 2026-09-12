import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import {
  activateInvite,
  apiSession,
  type ApiSession,
  createStudent,
  get,
  patch,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [14.11.4/#614] The epic's end-to-end proof: request a backup, download
 * it, restore it back into the same tenant as a no-op, make one real
 * change and restore again to see exactly that one update with a
 * pre-restore snapshot to fall back on, then prove a TEACHER can reach
 * none of it — neither the API nor the UI.
 *
 * Runs against a *dedicated* tenant this spec provisions over the API
 * (`provisionSchool`, `activateInvite`), not the shared seeded one: a
 * successful restore (leg C) replaces the whole tenant's data, and
 * `playwright.config.ts`'s `fullyParallel: true` means another worker
 * could be mid-journey against the shared tenant at any moment. Zero DB
 * access anywhere in this file — the tenant, its admin, and every
 * assertion go through the API or the browser.
 *
 * `test.describe.serial` (precedent: `journeys/attendance.spec.ts`) keeps
 * this spec's legs in one worker, in order: leg B/C upload the file leg A
 * downloaded, and leg C's 1-update diff depends on leg A's seeded student
 * still existing (just renamed).
 */
test.describe.serial('backup and restore', () => {
  // Every leg here waits on a real background job (export, then restore)
  // to run to completion — work the 30s per-test default can't cover under
  // CI's concurrency. The individual `toBeVisible({ timeout: 60_000 })`
  // waits below were already asking for more than the per-test budget
  // allowed, so they could never actually spend it.
  test.setTimeout(120_000);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const schoolName = `E2E Backup School ${suffix}`;
  const schoolSlug = `e2e-backup-school-${suffix}`;
  const adminEmail = `backup-admin-${suffix}@e2e.example.com`;

  let adminContext: BrowserContext;
  let adminPage: Page;
  let adminSession: ApiSession;
  let downloadPath: string;
  let studentId = '';
  const studentName = `Backup ${Date.now()}`;

  test.beforeAll(async ({ browser, playwright }) => {
    const setupRequest = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      const superAdmin = await superAdminApiSession(setupRequest);
      const provisioned = await provisionSchool(
        setupRequest,
        superAdmin,
        schoolName,
        schoolSlug,
        'Backup Admin',
        adminEmail,
      );
      const inviteToken = await resendSchoolAdminInvitation(
        setupRequest,
        superAdmin,
        provisioned.schoolId,
        provisioned.adminUserId,
      );
      const activated = await activateInvite(setupRequest, inviteToken, 'A-strong-backup-pw-1');
      adminSession = { token: activated.token, tenantId: activated.tenantId };

      // The activate call above already left a refresh cookie on
      // `setupRequest`'s own cookie jar — reuse it as the new browser
      // context's storage state instead of logging in again, plus the
      // `biddaloy:activeTenant` localStorage entry `freshLogin`
      // (`fixtures/test.ts`) sets for every other role.
      const state = await setupRequest.storageState();
      adminContext = await browser.newContext({
        storageState: {
          ...state,
          origins: [
            {
              origin: shells.app.baseURL.replace(/\/$/, ''),
              localStorage: [
                {
                  name: 'biddaloy:activeTenant',
                  value: JSON.stringify({ tenantId: activated.tenantId, role: activated.role }),
                },
              ],
            },
          ],
        },
      });
    } finally {
      await setupRequest.dispose();
    }
    adminPage = await adminContext.newPage();
  });

  test.afterAll(async () => {
    await adminContext.close();
  });

  test('Leg A: request a backup, poll it to DONE, download a non-empty .xlsx', async ({
    request,
  }) => {
    const student = await createStudent(request, adminSession, studentName);
    studentId = student.id;

    await adminPage.goto('/settings');
    await adminPage.getByRole('button', { name: t('backup.requestExport') }).click();

    // `DataTable` renders a real `<table>` above 768px of *container* width
    // and a card list (`list`/`listitem`) below it — the settings column is
    // narrow enough for cards here, so a `getByRole('row')` locator matches
    // nothing. Scope to the jobs list by its accessible name (the caption,
    // which both layouts expose) and assert within it: this tenant is
    // provisioned fresh by `beforeAll` and has exactly one job.
    const jobsList = adminPage
      .getByRole('table', { name: t('backup.jobsListTitle') })
      .or(adminPage.getByRole('list', { name: t('backup.jobsListTitle') }));

    await expect(jobsList.getByText(t('backup.status.DONE'))).toBeVisible({ timeout: 60_000 });

    const downloadPromise = adminPage.waitForEvent('download');
    await jobsList.getByRole('button', { name: t('backup.download') }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    // `download.path()` is a temp file named after a bare UUID with no
    // extension, and legs B/C feed this path straight back into the file
    // input — where `BulkUploadPreview`'s fail-fast extension check would
    // (correctly) reject it. Save it under its real `.xlsx` name instead.
    downloadPath = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(downloadPath);
    expect(fs.statSync(downloadPath).size).toBeGreaterThan(0);
  });

  test('Leg B: re-uploading the same file previews zero changes and Confirm stays disabled', async () => {
    await adminPage.getByLabel(t('bulkImport.chooseFile')).setInputFiles(downloadPath);

    const totalsRow = adminPage.getByRole('row', { name: new RegExp(t('backup.diffTotalsRow')) });
    await expect(totalsRow).toBeVisible({ timeout: 15_000 });
    const [, creates, updates, unchanged, deletes] = await totalsRow
      .getByRole('cell')
      .allTextContents();
    // [Tab, Create, Update, Unchanged, Delete] — `RestoreDiffSummary`'s
    // column order in restore-wizard.tsx. Unchanged comes *before* Delete.
    expect(creates).toBe('0');
    expect(updates).toBe('0');
    expect(deletes).toBe('0');
    // Every row matched, rather than the workbook being read as empty —
    // which would also show zero creates/updates/deletes.
    expect(Number(unchanged)).toBeGreaterThan(0);

    await expect(adminPage.getByRole('button', { name: t('bulkImport.confirm') })).toBeDisabled();

    // Reset the wizard so leg C starts from a fresh upload slot.
    await adminPage.getByRole('button', { name: t('bulkImport.uploadAnother') }).click();
  });

  test('Leg C: after a real change, the same file previews exactly one update, then restores', async ({
    request,
  }) => {
    await patch(request, adminSession, `/students/${studentId}`, {
      full_name: `${studentName} Renamed`,
    });

    await adminPage.getByLabel(t('bulkImport.chooseFile')).setInputFiles(downloadPath);

    const totalsRow = adminPage.getByRole('row', { name: new RegExp(t('backup.diffTotalsRow')) });
    await expect(totalsRow).toBeVisible({ timeout: 15_000 });
    const [, creates, updates, , deletes] = await totalsRow.getByRole('cell').allTextContents();
    // Exactly the one renamed student comes back as an update, and nothing
    // is created or deleted.
    expect(creates).toBe('0');
    expect(updates).toBe('1');
    expect(deletes).toBe('0');

    const confirmButton = adminPage.getByRole('button', { name: t('bulkImport.confirm') });
    await expect(confirmButton).toBeDisabled();

    await adminPage.getByLabel(t('backup.confirmTypeNamePrompt', { schoolName })).fill(schoolName);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(adminPage.getByText(t('backup.restoreDone'))).toBeVisible({ timeout: 60_000 });
    await expect(
      adminPage.getByRole('button', { name: t('backup.downloadSnapshot') }),
    ).toBeVisible();

    const restoredStudent = await get<{ full_name: string }>(
      request,
      adminSession,
      `/students/${studentId}`,
    );
    expect(restoredStudent.full_name).toBe(studentName);
  });

  test.describe('Leg D: a TEACHER reaches neither the API nor the UI', () => {
    test.use(loggedIn('teacher'));

    test('POST /backup/export returns 403 and /settings shows the access-denied state', async ({
      page,
      request,
    }) => {
      const teacherSession = await apiSession(request, 'teacher');
      const response = await request.post('/api/v1/backup/export', {
        headers: {
          Authorization: `Bearer ${teacherSession.token}`,
          'X-Tenant-ID': teacherSession.tenantId,
        },
        data: {},
      });
      expect(response.status()).toBe(403);

      await page.goto('/settings');
      await expect(
        page.getByRole('heading', { name: t('common.accessDenied.title') }),
      ).toBeVisible();
    });
  });
});
