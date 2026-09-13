import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveRole, setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  backupKeys,
  downloadBackup,
  useBackupJob,
  useBackupJobs,
  usePinBackupJob,
  useRequestBackup,
  useRestoreBackup,
  useValidateBackup,
} from './backup';

describe('useBackupJobs', () => {
  it('lists backup jobs for the active tenant', async () => {
    const { result } = renderHookWithProviders(() => useBackupJobs(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0]?.id).toBe('backup-job-1');
  });

  it('polls while a job on the page is QUEUED/RUNNING, and stops once every job is terminal', async () => {
    // Regression: nothing else refetches this list, so a row invalidated
    // onto the page as QUEUED/RUNNING (e.g. right after useRequestBackup's
    // mutation succeeds) used to be stuck at that status forever — the row
    // never moved to DONE without an unrelated navigation or manual reload.
    let requestCount = 0;
    server.use(
      http.get('/api/v1/backup/jobs', () => {
        requestCount += 1;
        const status = requestCount === 1 ? 'RUNNING' : 'DONE';
        return HttpResponse.json({
          data: [
            {
              id: 'backup-job-1',
              status,
              kind: 'EXPORT',
              source: 'MANUAL',
              requested_by: { id: 'user-1', full_name: 'Rahim Uddin' },
              size_bytes: null,
              row_counts: null,
              progress: null,
              failed_tab: null,
              snapshot_job_id: null,
              error: null,
              pinned: false,
              expires_at: null,
              created_at: new Date().toISOString(),
              finished_at: status === 'DONE' ? new Date().toISOString() : null,
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useBackupJobs(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await waitFor(() => expect(result.current.data?.data[0]?.status).toBe('RUNNING'));
    await waitFor(() => expect(result.current.data?.data[0]?.status).toBe('DONE'), {
      timeout: 5000,
    });

    const countAfterDone = requestCount;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(requestCount).toBe(countAfterDone);
  }, 10000);
});

describe('useBackupJob polling', () => {
  it('stops polling once the job reaches a terminal status (DONE)', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/backup/jobs/:id', ({ params }) => {
        requestCount += 1;
        // First poll: still running. Second poll onward: done.
        const status = requestCount === 1 ? 'RUNNING' : 'DONE';
        return HttpResponse.json({
          id: params.id,
          status,
          kind: 'EXPORT',
          source: 'MANUAL',
          requested_by: { id: 'user-1', full_name: 'Rahim Uddin' },
          size_bytes: null,
          row_counts: null,
          progress: null,
          failed_tab: null,
          snapshot_job_id: null,
          error: null,
          pinned: false,
          expires_at: null,
          created_at: new Date().toISOString(),
          finished_at: status === 'DONE' ? new Date().toISOString() : null,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useBackupJob('job-1'), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await waitFor(() => expect(result.current.data?.status).toBe('RUNNING'));

    // Advance past the 2s poll interval and let the DONE response land.
    await waitFor(() => expect(result.current.data?.status).toBe('DONE'), { timeout: 5000 });

    const countAfterDone = requestCount;
    // Give any further (incorrect) polling a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(requestCount).toBe(countAfterDone);
  }, 10000);
});

describe('usePinBackupJob', () => {
  it("invalidates both the job list and that job's detail after a successful pin", async () => {
    // A terminal job's `useBackupJob(id)` has stopped polling, so nothing
    // else would ever refresh its `pinned` — invalidating only the list
    // left a mounted detail view showing the old value.
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(backupKeys.list({}), { data: [], total: 0 });
    queryClient.setQueryData(backupKeys.detail('job-1'), { id: 'job-1', pinned: false });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    server.use(
      http.patch('/api/v1/backup/jobs/:id/pin', ({ params }) =>
        HttpResponse.json({ id: params.id, pinned: true }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePinBackupJob(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'job-1', pinned: true });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: backupKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: backupKeys.detail('job-1') });
  });

  it('invalidates the list and detail when the pin answers 410 (job deleted by retention)', async () => {
    // The server's conditional pin update matched no live row: retention
    // deleted the job between the list render and the click. The cached
    // row is stale, so the hook must refetch rather than leave a "Pin"
    // button on a backup that no longer exists.
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(backupKeys.list({}), { data: [], total: 0 });
    queryClient.setQueryData(backupKeys.detail('job-1'), { id: 'job-1', pinned: false });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    server.use(
      http.patch('/api/v1/backup/jobs/:id/pin', () =>
        HttpResponse.json({ message: 'gone' }, { status: 410 }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePinBackupJob(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'job-1', pinned: true }).catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: backupKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: backupKeys.detail('job-1') });
  });

  it('leaves the cache alone on a non-410 pin failure — the row is still real', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(backupKeys.list({}), { data: [], total: 0 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    server.use(
      http.patch('/api/v1/backup/jobs/:id/pin', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHookWithProviders(() => usePinBackupJob(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'job-1', pinned: true }).catch(() => undefined);
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useRequestBackup', () => {
  it('invalidates the backup jobs list after a successful request', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(backupKeys.list({}), { data: [], total: 0 });

    const { result } = renderHookWithProviders(() => useRequestBackup(), {
      queryClient,
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await act(async () => {
      const response = await result.current.mutateAsync();
      expect(response.job_id).toBeTruthy();
    });

    await waitFor(() => {
      const state = queryClient.getQueryState(backupKeys.list({}));
      expect(state?.isInvalidated).toBe(true);
    });
  });
});

describe('useValidateBackup', () => {
  it('reshapes the flat ValidateResponseDto into PreviewResult<RestoreSummary>', async () => {
    server.use(
      http.post('/api/v1/backup/validate', () =>
        HttpResponse.json({
          staging_id: 'staging-1',
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          meta: {
            schema_version: 1,
            kind: 'BACKUP',
            exported_at: new Date().toISOString(),
            app_version: '1.0.0',
            source_school_name: 'Some Other School',
            source_school_slug: 'some-other-school',
          },
          tabs: [
            { name: 'students', present: true, creates: 1, updates: 2, unchanged: 3, deletes: 0 },
          ],
          totals: { creates: 1, updates: 2, unchanged: 3, deletes: 0 },
          errors: [],
          warnings: [
            { row: 1, column: null, message: 'sheet guardians not present', severity: 'warning' },
          ],
          hard_error_count: 0,
          is_empty_tenant: false,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useValidateBackup(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    const file = new File(['x'], 'backup.xlsx');
    const preview = await result.current.mutateAsync({ file });

    // Flat response reshaped: staging_id/expires_at/errors/hard_error_count
    // stay top-level, everything else (meta/tabs/totals/warnings/
    // is_empty_tenant) moves under `summary`.
    expect(preview.staging_id).toBe('staging-1');
    expect(preview.hard_error_count).toBe(0);
    expect(preview.summary.tabs).toEqual([
      { name: 'students', present: true, creates: 1, updates: 2, unchanged: 3, deletes: 0 },
    ]);
    expect(preview.summary.warnings[0]?.message).toBe('sheet guardians not present');
    expect(preview.summary.meta.source_school_name).toBe('Some Other School');
  });
});

describe('useRestoreBackup', () => {
  it('sends staging_id/confirmation/invite_users and resolves job_id/snapshot_job_id', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/v1/backup/restore', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { job_id: 'restore-job-1', snapshot_job_id: 'snapshot-job-1' },
          { status: 202 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useRestoreBackup(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    const response = await result.current.mutateAsync({
      staging_id: 'staging-1',
      confirmation: 'Green Valley School',
      invite_users: true,
    });

    expect(capturedBody).toEqual({
      staging_id: 'staging-1',
      confirmation: 'Green Valley School',
      invite_users: true,
    });
    expect(response).toEqual({ job_id: 'restore-job-1', snapshot_job_id: 'snapshot-job-1' });
  });
});

describe('downloadBackup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a blob from the response bytes and triggers a click-to-save', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');
    await downloadBackup('job-1');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    // jsdom's XHR `responseType: 'blob'` path re-wraps the response body
    // rather than preserving its exact bytes 1:1, so this only asserts
    // that *some* non-empty blob reached the anchor, not the exact text —
    // the response-bytes contract is exercised for real in Playwright/e2e.
    expect(blobArg.size).toBeGreaterThan(0);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The blob URL is revoked on a deferred macrotask (Safari-safe pattern
    // shared with downloadCsv), not synchronously — wait for it.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'));
  });
});

/**
 * [item 8, money-tier review] `tenantId` on `useBackupJob`/`useValidateBackup`/
 * `useRestoreBackup` threads an `X-Tenant-ID` override into the request (via
 * `apiClient`'s `_tenantOverride` config field — see `client.spec.ts`'s own
 * tests for the interceptor mechanism itself). These tests only cover that
 * the header actually reaches the server with the OVERRIDE tenant, never the
 * ambient one the test harness sets up.
 */
describe('useBackupJob tenantId option', () => {
  it('sends the override tenant header, not the ambient active tenant', async () => {
    server.use(
      http.get('/api/v1/backup/jobs/job-1', ({ request }) => {
        expect(request.headers.get('X-Tenant-ID')).toBe('new-school-tenant');
        return HttpResponse.json({
          id: 'job-1',
          kind: 'RESTORE',
          status: 'DONE',
          source: 'MANUAL',
          requested_by: null,
          size_bytes: null,
          row_counts: null,
          progress: null,
          failed_tab: null,
          snapshot_job_id: null,
          error: null,
          pinned: false,
          expires_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          finished_at: null,
        });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useBackupJob('job-1', { tenantId: 'new-school-tenant' }),
      { tenantId: 'platform-tenant', role: 'SUPER_ADMIN' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('falls back to the ambient active tenant when tenantId is omitted', async () => {
    server.use(
      http.get('/api/v1/backup/jobs/job-1', ({ request }) => {
        expect(request.headers.get('X-Tenant-ID')).toBe('ambient-tenant');
        return HttpResponse.json({
          id: 'job-1',
          kind: 'RESTORE',
          status: 'DONE',
          source: 'MANUAL',
          requested_by: null,
          size_bytes: null,
          row_counts: null,
          progress: null,
          failed_tab: null,
          snapshot_job_id: null,
          error: null,
          pinned: false,
          expires_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          finished_at: null,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useBackupJob('job-1'), {
      tenantId: 'ambient-tenant',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useValidateBackup tenantId option', () => {
  it('sends the override tenant header on the multipart validate request', async () => {
    server.use(
      http.post('/api/v1/backup/validate', ({ request }) => {
        expect(request.headers.get('X-Tenant-ID')).toBe('new-school-tenant');
        return HttpResponse.json({
          staging_id: 'staging-1',
          expires_at: '2026-01-01T00:00:00.000Z',
          meta: {
            schema_version: 1,
            kind: 'FULL',
            exported_at: '2026-01-01T00:00:00.000Z',
            app_version: '1.0.0',
            source_school_name: 'Source School',
            source_school_slug: 'source-school',
          },
          tabs: [],
          totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
          errors: [],
          warnings: [],
          hard_error_count: 0,
          is_empty_tenant: true,
        });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useValidateBackup({ tenantId: 'new-school-tenant' }),
      { tenantId: 'platform-tenant', role: 'SUPER_ADMIN' },
    );

    result.current.mutate({ file: new File(['x'], 'workbook.xlsx') });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useRestoreBackup tenantId option', () => {
  it('sends the override tenant header on the restore request', async () => {
    server.use(
      http.post('/api/v1/backup/restore', ({ request }) => {
        expect(request.headers.get('X-Tenant-ID')).toBe('new-school-tenant');
        return HttpResponse.json({ job_id: 'job-1', snapshot_job_id: 'snap-1' }, { status: 202 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useRestoreBackup({ tenantId: 'new-school-tenant' }),
      { tenantId: 'platform-tenant', role: 'SUPER_ADMIN' },
    );

    result.current.mutate({ staging_id: 'staging-1', confirmation: 'New School' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ job_id: 'job-1', snapshot_job_id: 'snap-1' });
  });
});
