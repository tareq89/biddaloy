import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { cockpitHandlers } from '../test/msw/handlers/cockpit';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  getApprovalRequestId,
  useApprovalsSetting,
  useDecideApproval,
  usePlatformApprovals,
  useSetApprovalsSetting,
} from './platform-approvals';

afterEach(async () => {
  await cleanupTestState();
});

describe('platform approvals hooks', () => {
  it('usePlatformApprovals: loading then rows; sends the status filter', async () => {
    let status: string | null = null;
    server.use(
      http.get('*/platform/approvals', ({ request }) => {
        status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(() => usePlatformApprovals({ status: 'PENDING' }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(status).toBe('PENDING');
  });

  it('usePlatformApprovals: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/approvals', 500));
    const { result } = renderHookWithProviders(() => usePlatformApprovals());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useApprovalsSetting: reads the switch', async () => {
    const { result } = renderHookWithProviders(() => useApprovalsSetting());
    await waitFor(() => expect(result.current.data).toEqual({ enabled: true }));
  });

  it('useDecideApproval: a 404 comes out as an ApiError and is not retried', async () => {
    let calls = 0;
    server.use(
      http.post('*/platform/approvals/:id/approve', () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'Not found', timestamp: '', path: '/', requestId: 'r' },
          { status: 404 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useDecideApproval());
    act(() =>
      result.current.mutate({ id: '22222222-2222-4222-8222-222222222222', decision: 'approve' }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(404);
    expect(calls).toBe(1);
  });

  it('useDecideApproval: deny succeeds on 204', async () => {
    const { result } = renderHookWithProviders(() => useDecideApproval());
    await act(() =>
      result.current.mutateAsync({ id: '22222222-2222-4222-8222-222222222222', decision: 'deny' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('useSetApprovalsSetting: turning it OFF exposes the requestId; the retry carries X-Platform-Approval', async () => {
    server.use(
      cockpitHandlers.approvalRequested('patch', '*/platform/settings/approvals', 'req-9'),
    );
    const { result } = renderHookWithProviders(() => useSetApprovalsSetting());
    act(() => result.current.mutate({ enabled: false }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getApprovalRequestId(result.current.error)).toBe('req-9');

    let header: string | null = null;
    server.use(
      http.patch('*/platform/settings/approvals', ({ request }) => {
        header = request.headers.get('x-platform-approval');
        return HttpResponse.json({ enabled: false });
      }),
    );
    await act(() => result.current.mutateAsync({ enabled: false, approvalId: 'req-9' }));
    expect(header).toBe('req-9');
  });

  it('getApprovalRequestId: null for any other error', () => {
    expect(getApprovalRequestId(new Error('x'))).toBeNull();
    expect(getApprovalRequestId(null)).toBeNull();
    expect(
      getApprovalRequestId({ statusCode: 403, details: { code: 'APPROVAL_REQUIRED' } }),
    ).toBeNull();
  });
});
