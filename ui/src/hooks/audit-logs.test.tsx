import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { auditEntryFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { auditLogKeys, useAuditLogs, useAuditLogsByEntity, useLoginAuditLogs } from './audit-logs';

describe('useAuditLogs', () => {
  it('[8.11.10] maps its camelCase filters onto the endpoint’s snake_case params', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/audit-logs', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({
          data: [auditEntryFactory({ action: 'UPDATE' })],
          total: 1,
          page: 2,
          limit: 25,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useAuditLogs({
          action: 'UPDATE',
          entityType: 'Student',
          performedByUserId: 'user-1',
          fromDate: '2026-01-01',
          toDate: '2026-01-31',
          page: 2,
          limit: 25,
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('action')).toBe('UPDATE');
    expect(params!.get('entity_type')).toBe('Student');
    expect(params!.get('performed_by_user_id')).toBe('user-1');
    expect(params!.get('from_date')).toBe('2026-01-01');
    expect(params!.get('to_date')).toBe('2026-01-31');
    expect(params!.get('page')).toBe('2');
    expect(params!.get('limit')).toBe('25');
  });

  // `entityId` is only ever a cache-key discriminator for the
  // entity-scoped hook, whose id travels in the path — `GET /audit-logs`
  // has no `entity_id` param, and sending one would be a 400 the moment
  // `QueryAuditLogDto` gains `forbidNonWhitelisted`.
  it('[8.11.10] never sends entityId as a query param', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/audit-logs', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useAuditLogs({ entityId: 'student-1' }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('entity_id')).toBeNull();
    expect(Array.from(params!.keys())).toEqual([]);
  });

  it('[8.11.10] sends no filter params at all when given none', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/audit-logs', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useAuditLogs(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.from(params!.keys())).toEqual([]);
  });
});

// `auditLogKeys` is shared by three callers (the student Activity tab, the
// staff Login History tab and [8.11.10]'s tenant-wide page) — a change to
// its shape would silently break the other two's caches, so the emitted
// keys are asserted rather than assumed.
describe('auditLogKeys', () => {
  it('keeps its hierarchical shape so one lists() invalidation reaches every variant', () => {
    expect(auditLogKeys.all).toEqual(['audit-logs']);
    expect(auditLogKeys.lists()).toEqual(['audit-logs', 'list']);
    expect(auditLogKeys.list()).toEqual(['audit-logs', 'list', {}]);
    expect(auditLogKeys.list({ action: 'LOGIN', performedByUserId: 'user-1' })).toEqual([
      'audit-logs',
      'list',
      { action: 'LOGIN', performedByUserId: 'user-1' },
    ]);
  });
});

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
