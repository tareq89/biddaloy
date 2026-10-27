import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useCreateArrivalSubscription,
  useLockArrivalSubscription,
  usePatchArrivalSubscription,
  usePortalArrivalSubscriptions,
  usePutPortalArrivalSubscription,
} from './arrival-subscriptions';

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
