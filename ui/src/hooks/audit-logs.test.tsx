import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { auditEntryFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useAuditLogsByEntity } from './audit-logs';

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
