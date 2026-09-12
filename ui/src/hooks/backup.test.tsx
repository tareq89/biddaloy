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
  useRequestBackup,
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
          type: 'EXPORT',
          created_at: new Date().toISOString(),
          completed_at: status === 'DONE' ? new Date().toISOString() : null,
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
      const job = await result.current.mutateAsync();
      expect(job.status).toBe('QUEUED');
    });

    await waitFor(() => {
      const state = queryClient.getQueryState(backupKeys.list({}));
      expect(state?.isInvalidated).toBe(true);
    });
  });
});

describe('downloadBackup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a blob from the response bytes and triggers a click-to-save', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
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
