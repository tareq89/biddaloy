import { UserRole } from '@biddaloy/shared';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { cockpitHandlers } from '../test/msw/handlers/cockpit';
import { SCHOOL_BLOCKED } from '../test/msw/handlers/platform';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useEndLoginAs,
  useLoginAsCandidates,
  useLoginAsSessions,
  useStartLoginAs,
} from './platform-impersonation';

afterEach(async () => {
  await cleanupTestState();
});

const SCHOOL = '00000000-0000-4000-8000-000000000101';
const input = {
  schoolId: SCHOOL,
  role: UserRole.TEACHER,
  targetUserId: '00000000-0000-4000-8000-000000000201',
  reason: 'Parent could not see the timetable',
  viewOnly: true,
};

describe('platform impersonation hooks', () => {
  it('useLoginAsSessions: loading, rows, and limit is clamped to 100', async () => {
    let limit: string | null = null;
    server.use(
      http.get('*/platform/impersonation', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(() => useLoginAsSessions({ limit: 500 }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(limit).toBe('100');
  });

  it('useLoginAsSessions: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/impersonation', 500));
    const { result } = renderHookWithProviders(() => useLoginAsSessions());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useLoginAsCandidates: one person per greyed reason', async () => {
    const { result } = renderHookWithProviders(() => useLoginAsCandidates(SCHOOL));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.candidates.map((c) => c.unavailableReason)).toEqual([
      null,
      'NO_LOGIN_ACCOUNT',
      'INACTIVE',
    ]);
  });

  it('useStartLoginAs: allowed school gives a code', async () => {
    const { result } = renderHookWithProviders(() => useStartLoginAs());
    const out = await act(() => result.current.mutateAsync(input));
    expect(out).toMatchObject({ kind: 'code', code: 'one-time-code' });
  });

  it('useStartLoginAs: ask school (REQUESTED, no code) is waiting', async () => {
    const { result } = renderHookWithProviders(() => useStartLoginAs());
    const out = await act(() =>
      result.current.mutateAsync({ ...input, schoolId: '00000000-0000-4000-8000-000000000102' }),
    );
    expect(out).toEqual({ kind: 'waiting', requestId: '00000000-0000-4000-8000-000000000302' });
  });

  it('useStartLoginAs: APPROVAL_REQUESTED is waiting; for a blocked school, blocked-needs-owner', async () => {
    server.use(cockpitHandlers.approvalRequested('post', '*/platform/impersonation', 'req-4'));
    const { result } = renderHookWithProviders(() => useStartLoginAs());
    expect(await act(() => result.current.mutateAsync(input))).toEqual({
      kind: 'waiting',
      requestId: 'req-4',
    });
    expect(
      await act(() =>
        result.current.mutateAsync({ ...input, schoolId: SCHOOL_BLOCKED, supportMode: 'blocked' }),
      ),
    ).toEqual({ kind: 'blocked-needs-owner', requestId: 'req-4' });
  });

  it('useStartLoginAs: a repeated click reuses the Idempotency-Key; an error is not retried', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/platform/impersonation', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json(
          { statusCode: 409, message: 'x', timestamp: '', path: '/', requestId: 'r' },
          { status: 409 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useStartLoginAs());
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => undefined);
      await result.current.mutateAsync(input).catch(() => undefined);
    });
    expect(keys).toHaveLength(2); // one call per click, no auto-retry
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect((result.current.error as ApiError).statusCode).toBe(409);
  });

  it('useEndLoginAs: succeeds on 204', async () => {
    const { result } = renderHookWithProviders(() => useEndLoginAs());
    await act(() => result.current.mutateAsync({ id: '00000000-0000-4000-8000-000000000301' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
