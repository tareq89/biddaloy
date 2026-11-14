import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useChangeSchoolPlan,
  useCreatePlan,
  useMakePlanDefault,
  usePlatformPlans,
  useUpdatePlan,
} from './platform-plans';

afterEach(async () => {
  await cleanupTestState();
});

const PLAN = '33333333-3333-4333-8333-333333333333';

describe('platform plans hooks', () => {
  it('list: loading, then plans with one inactive', async () => {
    const { result } = renderHookWithProviders(() => usePlatformPlans());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some((p) => !p.active)).toBe(true);
  });

  it('list: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/plans', 500));
    const { result } = renderHookWithProviders(() => usePlatformPlans());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('create: Idempotency-Key is stable across a double click, and a 500 is sent once', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/platform/plans', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(
          { statusCode: 500, message: 'Boom', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useCreatePlan());
    act(() => {
      result.current.mutate({ name: 'Gold', unit_price_paisa: 7000 });
      result.current.mutate({ name: 'Gold', unit_price_paisa: 7000 });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys).toHaveLength(2); // two clicks, no retries on top
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('edit, make default and change a school plan hit their routes', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'GET') seen.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    const upd = renderHookWithProviders(() => useUpdatePlan());
    act(() => upd.result.current.mutate({ id: PLAN, active: false }));
    await waitFor(() => expect(upd.result.current.isSuccess).toBe(true));
    const def = renderHookWithProviders(() => useMakePlanDefault());
    act(() => def.result.current.mutate({ id: PLAN }));
    await waitFor(() => expect(def.result.current.isSuccess).toBe(true));
    const chg = renderHookWithProviders(() =>
      useChangeSchoolPlan('44444444-4444-4444-8444-444444444444'),
    );
    act(() => chg.result.current.mutate({ plan_id: PLAN, reason: 'upgrade' }));
    await waitFor(() => expect(chg.result.current.isSuccess).toBe(true));
    expect(seen).toEqual([
      `PATCH /api/v1/platform/plans/${PLAN}`,
      `POST /api/v1/platform/plans/${PLAN}/make-default`,
      'POST /api/v1/platform/billing/schools/44444444-4444-4444-8444-444444444444/plan',
    ]);
    server.events.removeAllListeners();
  });
});
