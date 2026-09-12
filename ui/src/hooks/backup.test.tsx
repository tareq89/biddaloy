import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useBackupJob, useRestoreBackup, useValidateBackup } from './backup';

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
