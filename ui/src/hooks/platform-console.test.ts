import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { cockpitHandlers } from '../test/msw/handlers/cockpit';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { getApprovalRequestId } from './platform-approvals';
import {
  useAnnouncements,
  useOpsQueues,
  useOpsSystem,
  usePlatformAudit,
  usePlatformAuditSessions,
  usePlatformUserSearch,
  usePreviewAnnouncement,
  useRetryFailedQueue,
  useSendAnnouncement,
} from './platform-console';

afterEach(async () => {
  await cleanupTestState();
});

const announcement = {
  statusFilter: ['ACTIVE' as const],
  title: 'Planned maintenance',
  body: 'Short downtime tonight.',
  severity: 'REMINDER' as const,
  sms: false,
  email: true,
};

describe('platform console hooks', () => {
  it('usePlatformUserSearch: waits for 3 characters, then loads', async () => {
    const short = renderHookWithProviders(() => usePlatformUserSearch('an'));
    expect(short.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => usePlatformUserSearch('anika'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.fullName).toBe('Anika Rahman');
  });

  it('usePlatformAudit: cursor paging, never sends offset; limit capped', async () => {
    let qs = new URLSearchParams();
    server.use(
      http.get('*/platform/audit', ({ request }) => {
        qs = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { result } = renderHookWithProviders(() =>
      usePlatformAudit({ cursor: 'c1', limit: 999 }),
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qs.get('cursor')).toBe('c1');
    expect(qs.get('limit')).toBe('100');
    expect(qs.has('offset')).toBe(false);
  });

  it('usePlatformAudit: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/audit', 500));
    const { result } = renderHookWithProviders(() => usePlatformAudit());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('audit sessions, queues and system card load', async () => {
    const a = renderHookWithProviders(() => usePlatformAuditSessions());
    const q = renderHookWithProviders(() => useOpsQueues());
    const s = renderHookWithProviders(() => useOpsSystem());
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(q.result.current.data?.queues).toHaveLength(2));
    await waitFor(() => expect(s.result.current.data?.database).toBe('ok'));
  });

  it('useRetryFailedQueue: sends an Idempotency-Key', async () => {
    let key: string | null = null;
    server.use(
      http.post('*/platform/ops/queues/:name/retry-failed', ({ request }) => {
        key = request.headers.get('idempotency-key');
        return HttpResponse.json({ retried: 2 });
      }),
    );
    const { result } = renderHookWithProviders(() => useRetryFailedQueue());
    await act(() => result.current.mutateAsync({ name: 'sms' }));
    expect(key).toBeTruthy();
  });

  it('useAnnouncements: loads rows', async () => {
    const { result } = renderHookWithProviders(() => useAnnouncements());
    await waitFor(() => expect(result.current.data?.total).toBe(1));
  });

  it('usePreviewAnnouncement: returns the counts', async () => {
    const { result } = renderHookWithProviders(() => usePreviewAnnouncement());
    const r = await act(() => result.current.mutateAsync({ statusFilter: ['ACTIVE'] }));
    expect(r).toEqual({ schools: 4, people: 6 });
  });

  it('useSendAnnouncement: same body keeps one Idempotency-Key; two-owner wait carries requestId; no retry', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/platform/announcements', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json(
          { statusCode: 500, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useSendAnnouncement());
    await act(async () => {
      await result.current.mutateAsync(announcement).catch(() => undefined);
      await result.current.mutateAsync(announcement).catch(() => undefined);
    });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect((result.current.error as ApiError).statusCode).toBe(500);

    server.use(cockpitHandlers.approvalRequested('post', '*/platform/announcements', 'req-7'));
    await act(() => result.current.mutateAsync(announcement).catch(() => undefined));
    expect(getApprovalRequestId(result.current.error)).toBe('req-7');
  });
});
