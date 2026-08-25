import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { auditEntryFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useAuditLogsByEntity, useLoginAuditLogs } from './audit-logs';

describe('useLoginAuditLogs', () => {
  it('[8.11.8] scopes the tenant-wide list to one user’s LOGIN events', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/audit-logs', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({
          data: [auditEntryFactory({ action: 'LOGIN', performed_by_user_id: 'user-1' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useLoginAuditLogs('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('action')).toBe('LOGIN');
    expect(params!.get('performed_by_user_id')).toBe('user-1');
    expect(result.current.data?.data[0]?.action).toBe('LOGIN');
  });
});

describe('useAuditLogsByEntity', () => {
  it("[8.10.2] requests the entity's own path segments and resolves its Activity tab page", async () => {
    let requestedPath = '';
    server.use(
      http.get('/api/v1/audit-logs/entity/:entityType/:entityId', ({ params }) => {
        requestedPath = `${String(params.entityType)}/${String(params.entityId)}`;
        return HttpResponse.json({
          data: [auditEntryFactory({ entity_type: 'Student', entity_id: 'student-1' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useAuditLogsByEntity('Student', 'student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedPath).toBe('Student/student-1');
    expect(result.current.data?.data).toHaveLength(1);
  });
});
