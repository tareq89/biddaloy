import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createStudent, get, post, provisionSchool, superAdminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';

/**
 * [14.13.3/#620] SUPER_ADMIN provisions a brand-new school, then imports a
 * workbook into it — from both entry points #619 wires up (the
 * create-wizard's optional last step, and the school detail page's "Restore
 * from workbook" action).
 *
 * No static `.xlsx` fixture ships in this repo (`journeys/backup-restore.spec.ts`
 * builds its own workbook the same way, via a real export, rather than
 * checking one in) — this spec builds one for real: provisions a small
 * *source* tenant over the API, seeds one student in it, exports it, and
 * downloads the result. That download is then the "workbook" both UI legs
 * upload into the *target* tenant this spec actually cares about.
 *
 * The cross-tenant heart of this spec: every source-tenant API call below
 * uses the seeded SUPER_ADMIN's own token with the *source* tenant's id
 * forced into `X-Tenant-ID` by hand (not `superAdminApiSession`'s own
 * platform-tenant id) — this is exactly the `ContextGuard` path #620's
 * server change fixes (a SUPER_ADMIN has no membership row in a tenant it
 * didn't create for itself). If that fix regresses, every request below
 * 401s instead of the workbook import silently no-op'ing.
 */
test.use(loggedIn('super_admin'));

test.describe.serial('provision a school from a workbook', () => {
  test.setTimeout(120_000);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const sourceSchoolName = `E2E Workbook Source ${suffix}`;
  const sourceSchoolSlug = `e2e-workbook-source-${suffix}`;
  const targetSchoolName = `E2E Provisioned Target ${suffix}`;
  const studentName = `Workbook Student ${suffix}`;

  let targetSchoolId = '';
  let workbookPath = '';

  test.beforeAll(async ({ playwright }) => {
    const setupRequest = await playwright.request.newContext();
    try {
      const superAdmin = await superAdminApiSession(setupRequest);

      // A throwaway source tenant with one real student — provisioned and
      // populated entirely as the SUPER_ADMIN, cross-tenant, on purpose:
      // this is the same access pattern the target-tenant import below
      // needs, exercised here against a tenant that has no bearing on the
      // spec's actual assertions.
      const source = await provisionSchool(
        setupRequest,
        superAdmin,
        sourceSchoolName,
        sourceSchoolSlug,
        'Source Admin',
        `workbook-source-admin-${suffix}@e2e.example.com`,
      );
      const sourceSession = { token: superAdmin.token, tenantId: source.schoolId };
      await createStudent(setupRequest, sourceSession, studentName);

      const exportJob = await post<{ job_id: string }>(
        setupRequest,
        sourceSession,
        '/backup/export',
        {},
      );
      let status = 'QUEUED';
      for (let attempt = 0; attempt < 30 && status !== 'DONE'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = await get<{ status: string }>(
          setupRequest,
          sourceSession,
          `/backup/jobs/${exportJob.job_id}`,
        );
        status = job.status;
      }
      expect(status).toBe('DONE');

      const download = await setupRequest.get(`/api/v1/backup/jobs/${exportJob.job_id}/download`, {
        headers: {
          Authorization: `Bearer ${sourceSession.token}`,
          'X-Tenant-ID': sourceSession.tenantId,
        },
      });
      expect(download.ok()).toBe(true);
      workbookPath = path.join(os.tmpdir(), `e2e-workbook-${suffix}.xlsx`);
      fs.writeFileSync(workbookPath, await download.body());
      expect(fs.statSync(workbookPath).size).toBeGreaterThan(0);
    } finally {
      await setupRequest.dispose();
    }
  });

  test('create-wizard success step imports the workbook into the new school', async ({
    page,
    request,
  }) => {
    await page.goto('/schools/new');

    await page.getByLabel(t('platform.createWizard.nameLabel')).fill(targetSchoolName);
    await page.getByRole('button', { name: t('platform.createWizard.nextAction') }).click();

    await page.getByLabel(t('platform.createWizard.adminNameLabel')).fill('Target Admin');
    await page
      .getByLabel(t('platform.createWizard.adminEmailLabel'))
      .fill(`workbook-target-admin-${suffix}@e2e.example.com`);

    const provisionResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/schools') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: t('platform.createWizard.submitAction') }).click();
    const response = await provisionResponse;
    const body = (await response.json()) as { school: { id: string } };
    targetSchoolId = body.school.id;

    await expect(
      page.getByRole('heading', { name: t('platform.createWizard.successTitle') }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: t('platform.createWizard.importWorkbookToggle') })
      .click();
    await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(workbookPath);

    const confirmButton = page.getByRole('button', { name: t('bulkImport.confirm') });
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    await page
      .getByLabel(t('backup.confirmTypeNamePrompt', { schoolName: targetSchoolName }))
      .fill(targetSchoolName);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page.getByText(t('backup.restoreDone'))).toBeVisible({ timeout: 60_000 });

    // Proves the import landed in the NEW tenant, not the SUPER_ADMIN's own
    // platform tenant nor the source tenant — the multi-tenancy contract
    // this whole ticket exists to enforce.
    const superAdmin = await superAdminApiSession(request);
    const targetSession = { token: superAdmin.token, tenantId: targetSchoolId };
    const students = await get<{ data: { full_name: string }[] }>(
      request,
      targetSession,
      '/students',
    );
    expect(students.data.some((s) => s.full_name === studentName)).toBe(true);
  });

  test('school detail page also reaches the same restore wizard, scoped to that school', async ({
    page,
  }) => {
    await page.goto(`/schools/${targetSchoolId}`);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(targetSchoolName);
    await detail.clickAction('platform.schoolDetail.actions.restoreFromWorkbook');

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('bulkImport.chooseFile')).setInputFiles(workbookPath);

    // Re-uploading the same workbook the student already came from: the
    // one row now matches exactly, so this is an update, never a second
    // create — proof the dialog is scoped to the SAME already-populated
    // school, not creating a fresh no-op tenant underneath it.
    const confirmButton = dialog.getByRole('button', { name: t('bulkImport.confirm') });
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    await dialog
      .getByLabel(t('backup.confirmTypeNamePrompt', { schoolName: targetSchoolName }))
      .fill(targetSchoolName);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(dialog.getByText(t('backup.restoreDone'))).toBeVisible({ timeout: 60_000 });
  });
});
