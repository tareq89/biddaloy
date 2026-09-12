import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import type { WorkbookJob } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupSection } from './backup-section';

/**
 * [612, corrected 14.11.5] Rebuilt against the real `WorkbookJobDto`
 * (`server/src/modules/workbook/export/dto/workbook-job.dto.ts`) — the
 * original fixtures here used an invented shape (`type`, `file_size_bytes`,
 * `completed_at`, `error_message`, a bare-string `requested_by`), which is
 * why this section crashed against the real API despite green tests.
 */
const SCHOOL_ID = 'school-1';

function jobFixture(overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id: 'job-1',
    kind: 'EXPORT',
    status: 'DONE',
    source: 'MANUAL',
    requested_by: { id: 'user-1', full_name: 'Rahim Uddin' },
    size_bytes: '2048',
    row_counts: null,
    progress: null,
    failed_tab: null,
    snapshot_job_id: null,
    error: null,
    pinned: false,
    expires_at: null,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('BackupSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('requests a backup and shows the queued job', async () => {
    // No `<Toaster />` is mounted in this test harness (`main.tsx`'s job in
    // the real app) — same reasoning as `staff/$userId.test.tsx`'s
    // identical comment — so this asserts the `toast.success` call itself.
    const toastSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/backup/export', () =>
        HttpResponse.json({ job_id: 'job-new' }, { status: 201 }),
      ),
    );

    const { user } = renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await user.click(await screen.findByRole('button', { name: 'Create a new backup' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("We'll email you when it's ready."));
  });

  it('renders requested_by.full_name and formats size_bytes (a bigint-string) for a finished job', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [jobFixture({ id: 'job-done', size_bytes: '2048' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderWithProviders(<BackupSection />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(await screen.findByText('2.0 KB')).toBeTruthy();
  });

  it('downloads a finished backup when Download is clicked', async () => {
    let downloadHits = 0;
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [jobFixture({ id: 'job-done' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/backup/jobs/:id/download', () => {
        downloadHits += 1;
        return new HttpResponse(new Blob(['bytes']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="backup.zip"' },
        });
      }),
    );

    const { user } = renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const downloadButton = await screen.findByRole('button', { name: 'Download' });
    await user.click(downloadButton);

    await waitFor(() => expect(downloadHits).toBe(1));
    expect(screen.queryByText("Couldn't download this backup. Try again.")).toBeNull();
  });

  it('shows an expired row as text instead of a Download button after a 410', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [jobFixture({ id: 'job-expired' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/backup/jobs/:id/download', () => new HttpResponse(null, { status: 410 })),
    );

    const { user } = renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const downloadButton = await screen.findByRole('button', { name: 'Download' });
    await user.click(downloadButton);

    expect(await screen.findByText('Expired')).toBeTruthy();
  });

  it('shows a failure reason (job.error, not job.error_message) instead of a Download action', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [
            jobFixture({
              id: 'job-failed',
              status: 'FAILED',
              error: 'Disk quota exceeded',
              size_bytes: null,
              finished_at: null,
            }),
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderWithProviders(<BackupSection />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText('Failed: Disk quota exceeded')).toBeTruthy();
  });

  it('shows the empty state when there are no jobs yet', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithProviders(<BackupSection />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText('No backups yet')).toBeTruthy();
  });

  it('shows the error state, not the empty state, when the jobs list request fails', async () => {
    server.use(http.get('/api/v1/backup/jobs', () => HttpResponse.json(null, { status: 500 })));

    renderWithProviders(<BackupSection />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText("Couldn't start the backup. Try again.")).toBeTruthy();
    expect(screen.queryByText('No backups yet')).toBeNull();
  });

  it('auto-downloads once for a ?backup=<jobId> deep link to a finished job', async () => {
    let downloadHits = 0;
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', ({ params }) =>
        HttpResponse.json(jobFixture({ id: params.id as string })),
      ),
      http.get('/api/v1/backup/jobs/:id/download', () => {
        downloadHits += 1;
        return new HttpResponse(new Blob(['bytes']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="backup.zip"' },
        });
      }),
    );

    renderWithProviders(<BackupSection backupJobId="job-linked" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await waitFor(() => expect(downloadHits).toBe(1));
  });

  it('handles a second deep link that arrives without a remount', async () => {
    // `backupJobId` is a search param, so following a second "your backup
    // is ready" link swaps the prop on the mounted component. A boolean
    // "already handled" flag used to swallow that second job entirely and
    // leave the first link's error on screen.
    const downloaded: string[] = [];
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', ({ params }) => {
        const id = params.id as string;
        // The first link points at a job that no longer exists, so it
        // renders the expired message; the second is downloadable.
        if (id === 'job-gone') return HttpResponse.json(null, { status: 404 });
        return HttpResponse.json(jobFixture({ id }));
      }),
      http.get('/api/v1/backup/jobs/:id/download', ({ params }) => {
        downloaded.push(params.id as string);
        return new HttpResponse(new Blob(['bytes']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="backup.zip"' },
        });
      }),
    );

    const { rerender } = renderWithProviders(<BackupSection backupJobId="job-gone" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('This backup has expired — request a new one.')).toBeTruthy();

    rerender(<BackupSection backupJobId="job-second" />);

    await waitFor(() => expect(downloaded).toEqual(['job-second']));
    // The first link's message must not outlive the link itself.
    expect(screen.queryByText('This backup has expired — request a new one.')).toBeNull();
  });

  it('shows an inline message for an unknown/expired deep-linked backup id', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', () => HttpResponse.json(null, { status: 404 })),
    );

    renderWithProviders(<BackupSection backupJobId="job-unknown" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('This backup has expired — request a new one.')).toBeTruthy();
  });

  it('shows the failed-job message (not the expired copy) for a FAILED deep-linked backup', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', ({ params }) =>
        HttpResponse.json(
          jobFixture({
            id: params.id as string,
            status: 'FAILED',
            error: 'Storage unavailable',
            size_bytes: null,
          }),
        ),
      ),
    );

    renderWithProviders(<BackupSection backupJobId="job-failed" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(
      await screen.findByText('Something went wrong while creating this backup.'),
    ).toBeTruthy();
    expect(screen.queryByText('This backup has expired — request a new one.')).toBeNull();
  });

  it('renders nothing without BACKUP_MANAGE permission', () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    // ACCOUNTANT has no BACKUP_MANAGE grant (see
    // `shared/src/enums/permissions.spec.ts`) — the section must render
    // nothing rather than an empty shell.
    const { container } = renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ACCOUNTANT',
      tenantId: SCHOOL_ID,
    });

    expect(container.firstChild).toBeNull();
  });
});
