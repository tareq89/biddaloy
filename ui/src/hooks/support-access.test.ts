import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { ApiError } from '../api/errors';
import { supportAccessHandlers } from '../test/msw/handlers/support-access';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useChangeSupportAccessMode,
  useConfirmSupportAccess,
  useDecideSupportRequest,
  useEndSupportSession,
  useSupportAccessSettings,
  useSupportPlatformActions,
  useSupportRequests,
  useSupportSessions,
} from './support-access';

beforeEach(() => setActiveTenant('tenant-1'));

afterEach(async () => {
  await cleanupTestState();
  setActiveTenant(null);
});

describe('support access hooks (school side)', () => {
  it('useSupportAccessSettings: loading, then the mode; another state via override', async () => {
    const { result } = renderHookWithProviders(() => useSupportAccessSettings());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data?.mode).toBe('allowed'));

    server.use(supportAccessHandlers.settings({ mode: 'blocked', needsConfirmation: true }));
    const other = renderHookWithProviders(() => useSupportAccessSettings());
    await waitFor(() => expect(other.result.current.data?.mode).toBe('blocked'));
  });

  it('useSupportAccessSettings: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/support-access/settings', 500));
    const { result } = renderHookWithProviders(() => useSupportAccessSettings());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useChangeSupportAccessMode + useConfirmSupportAccess succeed', async () => {
    const m = renderHookWithProviders(() => useChangeSupportAccessMode());
    expect((await act(() => m.result.current.mutateAsync('ask'))).mode).toBe('ask');
    const c = renderHookWithProviders(() => useConfirmSupportAccess());
    await act(() => c.result.current.mutateAsync({ allowed: true, textVersion: 1 }));
  });

  it('requests, sessions, platform actions load; limit capped at 100', async () => {
    let limit: string | null = null;
    server.use(
      http.get('*/support-access/requests', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json([]);
      }),
    );
    const r = renderHookWithProviders(() => useSupportRequests({ limit: 400 }));
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    expect(limit).toBe('100');
    const s = renderHookWithProviders(() => useSupportSessions());
    const p = renderHookWithProviders(() => useSupportPlatformActions());
    await waitFor(() => expect(s.result.current.data).toHaveLength(1));
    await waitFor(() => expect(p.result.current.data).toHaveLength(1));
  });

  it('useDecideSupportRequest: a 404 is an ApiError and is not retried', async () => {
    let calls = 0;
    server.use(
      http.post('*/support-access/requests/:id/approve', () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 404 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useDecideSupportRequest());
    act(() => result.current.mutate({ id: 'r1', decision: 'approve' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(404);
    expect(calls).toBe(1);
  });

  it('useEndSupportSession: ends a session', async () => {
    const { result } = renderHookWithProviders(() => useEndSupportSession());
    expect((await act(() => result.current.mutateAsync({ id: 's1' }))).status).toBe('ENDED');
  });
});
