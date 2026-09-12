import { File as NodeFile } from 'node:buffer';

import type { BackupJob, PreviewResult, RestoreSummary } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { RestoreWizard } from './restore-wizard';

/**
 * [613] RTL coverage: Confirm stays disabled until the exact school name
 * is typed and enables on the exact match; `hard_error_count > 0` disables
 * it no matter what; the empty-tenant variant swaps the deletes/scare copy
 * for `emptyTenantWorkbook`; progress polling renders → DONE and → FAILED.
 *
 * `BulkUploadPreview`'s own plumbing (aria-live wording, the countdown,
 * the error table's CSV export) is covered by `bulk-upload-preview.test.tsx`
 * and not duplicated here — same split `students/import.test.tsx` uses.
 *
 * Files use `node:buffer`'s `File`, not jsdom's — jsdom 30's Blob hangs
 * MSW's XHR body serialization for a multipart upload (see
 * `import.test.tsx`'s own comment on this).
 */
function makeFile(name = 'backup.xlsx'): File {
  return new NodeFile(['content'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }) as File;
}

function validateSummary(overrides: Partial<RestoreSummary> = {}): RestoreSummary {
  return {
    school_name: 'Green Valley School',
    source_school_name: 'Green Valley School',
    exported_at: new Date().toISOString(),
    is_empty_tenant: false,
    tabs: [{ tab: 'students', create: 12, update: 3, delete: 5, unchanged: 100, errors: 0 }],
    warnings: [],
    ...overrides,
  };
}

function mockValidate(result: PreviewResult<RestoreSummary>) {
  server.use(
    http.post('/api/v1/backup/validate', () => HttpResponse.json(result)),
  );
}

function mockRestore(job: BackupJob) {
  server.use(http.post('/api/v1/backup/restore', () => HttpResponse.json(job, { status: 201 })));
}

function mockJob(job: BackupJob) {
  server.use(http.get(`/api/v1/backup/jobs/${job.id}`, () => HttpResponse.json(job)));
}

async function renderAndUpload() {
  const result = renderWithProviders(<RestoreWizard />, {
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  await result.localeReady;

  const user = userEvent.setup();
  const input = await screen.findByLabelText('Choose file');
  await user.upload(input, makeFile());
  return { ...result, user };
}

afterEach(async () => {
  await cleanupTestState();
});

describe('RestoreWizard', () => {
  it('Confirm stays disabled until the exact school name is typed, and enables on an exact match', async () => {
    mockValidate({
      staging_id: 'staging-1',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    const { user } = await renderAndUpload();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(true));

    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Wrong Name');
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    await user.clear(input);
    await user.type(input, 'Green Valley School');
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false));
  });

  it('hard_error_count > 0 disables Confirm no matter what is typed', async () => {
    mockValidate({
      staging_id: 'staging-2',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [{ row: 1, column: null, message: 'bad', severity: 'error' }],
      hard_error_count: 1,
      summary: validateSummary(),
    });
    const { user } = await renderAndUpload();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Green Valley School');

    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('shows the empty-tenant copy instead of the deletes line when is_empty_tenant is true', async () => {
    mockValidate({
      staging_id: 'staging-3',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary({ is_empty_tenant: true, tabs: [] }),
    });
    await renderAndUpload();

    expect(
      await screen.findByText('This school has no data yet — the workbook will be imported as-is.'),
    ).toBeTruthy();
    expect(screen.queryByText(/records will be deleted/)).toBeNull();
  });

  it('progress polling renders DONE with per-tab counts and the snapshot download', async () => {
    mockValidate({
      staging_id: 'staging-4',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({
      id: 'job-restore-1',
      status: 'QUEUED',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
    });
    mockJob({
      id: 'job-restore-1',
      status: 'DONE',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      snapshot_job_id: 'snapshot-1',
      row_counts: { students: 12 },
    });

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Green Valley School');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Restore complete')).toBeTruthy();
    expect(await screen.findByText('Students: 12 records')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download pre-restore snapshot' })).toBeTruthy();
  });

  it('progress polling renders FAILED with the failed tab, reason, snapshot link and undo copy', async () => {
    mockValidate({
      staging_id: 'staging-5',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({
      id: 'job-restore-2',
      status: 'QUEUED',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
    });
    mockJob({
      id: 'job-restore-2',
      status: 'FAILED',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      failed_tab: 'guardians',
      error_message: 'Duplicate natural key',
      snapshot_job_id: 'snapshot-2',
    });

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Green Valley School');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('The restore stopped at Guardians')).toBeTruthy();
    expect(screen.getByText('Duplicate natural key')).toBeTruthy();
    expect(
      screen.getByText('The tabs before Guardians were applied — restore the snapshot to go back'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download pre-restore snapshot' })).toBeTruthy();
  });

  it('a job missing tabs_total falls back to the indeterminate progress copy', async () => {
    mockValidate({
      staging_id: 'staging-6',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });
    mockRestore({
      id: 'job-restore-3',
      status: 'RUNNING',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
    });
    mockJob({
      id: 'job-restore-3',
      status: 'RUNNING',
      type: 'RESTORE',
      created_at: new Date().toISOString(),
    });

    const { user } = await renderAndUpload();
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Green Valley School');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Working on it…')).toBeTruthy();
  });

  it('the invitations checkbox defaults off and its value reaches the restore payload', async () => {
    mockValidate({
      staging_id: 'staging-7',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      errors: [],
      hard_error_count: 0,
      summary: validateSummary(),
    });

    let capturedBody: { invite_restored_users?: boolean } | undefined;
    server.use(
      http.post('/api/v1/backup/restore', async ({ request }) => {
        capturedBody = (await request.json()) as { invite_restored_users?: boolean };
        return HttpResponse.json(
          {
            id: 'job-restore-4',
            status: 'QUEUED',
            type: 'RESTORE',
            created_at: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const { user } = await renderAndUpload();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Send invitations to restored users',
    });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    await user.click(checkbox);
    const input = screen.getByPlaceholderText("Type the school's name to confirm");
    await user.type(input, 'Green Valley School');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(capturedBody?.invite_restored_users).toBe(true));
  });
});
