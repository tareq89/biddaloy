import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useArrivalSubscriptions,
  useCreateArrivalSubscription,
  useLockArrivalSubscription,
  usePatchArrivalSubscription,
  usePortalArrivalSubscriptions,
  usePutPortalArrivalSubscription,
} from './arrival-subscriptions';
import { myClassKeys } from './my-class';

const sub = {
  id: 's1',
  student_id: 'st1',
  guardian_id: 'g1',
  status: 'ACTIVE',
  mode: 'ONCE',
  channel: 'PUSH',
  lock: 'NONE',
  consumed_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** A 500 must produce exactly one request (retry: false) carrying an Idempotency-Key. */
async function expectOneKeyedCall(
  method: 'post' | 'patch' | 'put',
  path: string,
  run: () => { mutate: () => void; isError: boolean },
) {
  let calls = 0;
  let key: string | null = null;
  server.use(
    http[method](path, ({ request }) => {
      calls += 1;
      key = request.headers.get('Idempotency-Key');
      return HttpResponse.json(apiErrorBody(500, 'boom', path), { status: 500 });
    }),
  );
  const { result } = renderHookWithProviders(run, { tenantId: 't1' });
  result.current.mutate();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(key).toBeTruthy();
  expect(calls).toBe(1);
}

describe('arrival subscription mutations send Idempotency-Key and never retry', () => {
  it('create', () =>
    expectOneKeyedCall('post', '/api/v1/attendance/arrival-subscriptions', () => {
      const m = useCreateArrivalSubscription();
      return {
        isError: m.isError,
        mutate: () => m.mutate({ student_id: 'st1', guardian_id: 'g1', mode: 'ONCE' }),
      };
    }));

  it('patch', () =>
    expectOneKeyedCall('patch', '/api/v1/attendance/arrival-subscriptions/s1', () => {
      const m = usePatchArrivalSubscription();
      return {
        isError: m.isError,
        mutate: () => m.mutate({ id: 's1', input: { status: 'OFF' } }),
      };
    }));

  it('lock', () =>
    expectOneKeyedCall('patch', '/api/v1/attendance/arrival-subscriptions/s1/lock', () => {
      const m = useLockArrivalSubscription();
      return { isError: m.isError, mutate: () => m.mutate({ id: 's1', lock: 'ALWAYS' }) };
    }));

  it('portal put', () =>
    expectOneKeyedCall('put', '/api/v1/portal/arrival-subscriptions/st1', () => {
      const m = usePutPortalArrivalSubscription();
      return {
        isError: m.isError,
        mutate: () => m.mutate({ studentId: 'st1', input: { want: true } }),
      };
    }));
});

describe('arrival mutations refresh My class', () => {
  // The My class badge shows the REQUESTED count, so a confirm must invalidate it.
  it('a successful patch invalidates myClassKeys.all', async () => {
    server.use(
      http.patch('/api/v1/attendance/arrival-subscriptions/s1', () => HttpResponse.json(sub)),
    );
    const { result, queryClient } = renderHookWithProviders(() => usePatchArrivalSubscription(), {
      tenantId: 't1',
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    result.current.mutate({ id: 's1', input: { status: 'ACTIVE' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: myClassKeys.all });
  });
});

describe('usePortalArrivalSubscriptions', () => {
  it('returns the school switches and children', async () => {
    server.use(
      http.get('/api/v1/portal/arrival-subscriptions', () =>
        HttpResponse.json({
          school: { enabled: true, smsAllowed: false },
          children: [{ student_id: 'st1', student_name: 'A', subscription: sub }],
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => usePortalArrivalSubscriptions(), {
      tenantId: 't1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.school).toEqual({ enabled: true, smsAllowed: false });
  });
});

describe('useArrivalSubscriptions', () => {
  // The My class badge counts every waiting request, so the list must not stop at one page.
  it('reads page after page until a short page comes back', async () => {
    const offsets: string[] = [];
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', ({ request }) => {
        const url = new URL(request.url);
        offsets.push(url.searchParams.get('offset') ?? '');
        const n = url.searchParams.get('offset') === '0' ? 100 : 3;
        return HttpResponse.json(Array.from({ length: n }, (_, i) => ({ ...sub, id: `s${i}` })));
      }),
    );
    const { result } = renderHookWithProviders(
      () => useArrivalSubscriptions({ sectionId: 'sec1' }),
      { tenantId: 't1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsets).toEqual(['0', '100']);
    expect(result.current.data).toHaveLength(103);
  });

  it('does not call the server when disabled', () => {
    const spy = vi.fn();
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', () => {
        spy();
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(
      () => useArrivalSubscriptions({ sectionId: 'sec1' }, { enabled: false }),
      { tenantId: 't1' },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });
});
