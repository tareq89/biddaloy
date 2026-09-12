import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupSection } from './backup-section';

const SCHOOL_ID = 'school-1';

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
        HttpResponse.json(
          {
            id: 'job-new',
            status: 'QUEUED',
            type: 'EXPORT',
            created_at: new Date().toISOString(),
            completed_at: null,
            requested_by: 'user-1',
            error_message: null,
            file_size_bytes: null,
          },
          { status: 201 },
        ),
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

  it('downloads a finished backup when Download is clicked', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [
            {
              id: 'job-done',
              status: 'DONE',
              type: 'EXPORT',
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              requested_by: 'user-1',
              error_message: null,
              file_size_bytes: 2048,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/backup/jobs/:id/download', () =>
        new HttpResponse(new Blob(['bytes']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="backup.zip"' },
        }),
      ),
    );

    const { user } = renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const downloadButton = await screen.findByRole('button', { name: 'Download' });
    await user.click(downloadButton);

    // `downloadBackup` triggers a throwaway-anchor save with no visible
    // confirmation — the button returning to its non-loading state (no
    // error toast fired) is the observable signal the download succeeded.
    await waitFor(() => expect(screen.queryByText('Downloading…')).toBeNull());
    expect(screen.queryByText("Couldn't download this backup. Try again.")).toBeNull();
  });

  it('shows an expired row as text instead of a Download button after a 410', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [
            {
              id: 'job-expired',
              status: 'DONE',
              type: 'EXPORT',
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              requested_by: 'user-1',
              error_message: null,
              file_size_bytes: 2048,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.get(
        '/api/v1/backup/jobs/:id/download',
        () => new HttpResponse(null, { status: 410 }),
      ),
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

  it('shows a failure reason instead of a Download action for a failed job', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({
          data: [
            {
              id: 'job-failed',
              status: 'FAILED',
              type: 'EXPORT',
              created_at: new Date().toISOString(),
              completed_at: null,
              requested_by: 'user-1',
              error_message: 'Disk quota exceeded',
              file_size_bytes: null,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('Failed: Disk quota exceeded')).toBeTruthy();
  });

  it('shows the empty state when there are no jobs yet', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithProviders(<BackupSection />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('No backups yet')).toBeTruthy();
  });

  it('auto-downloads once for a ?backup=<jobId> deep link to a finished job', async () => {
    let downloadHits = 0;
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', ({ params }) =>
        HttpResponse.json({
          id: params.id,
          status: 'DONE',
          type: 'EXPORT',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          requested_by: 'user-1',
          error_message: null,
          file_size_bytes: 4096,
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

    renderWithProviders(<BackupSection backupJobId="job-linked" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await waitFor(() => expect(downloadHits).toBe(1));
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

    expect(
      await screen.findByText('This backup has expired — request a new one.'),
    ).toBeTruthy();
  });

  it('shows the failed-job message (not the expired copy) for a FAILED deep-linked backup', async () => {
    server.use(
      http.get('/api/v1/backup/jobs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/backup/jobs/:id', ({ params }) =>
        HttpResponse.json({
          id: params.id,
          status: 'FAILED',
          type: 'EXPORT',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          requested_by: 'user-1',
          error_message: 'Storage unavailable',
          file_size_bytes: null,
        }),
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
