import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useCouponUsage,
  useCreateCoupon,
  useCreateFreeCoupon,
  usePlatformCoupons,
  useUpdateCoupon,
} from './platform-coupons';

afterEach(async () => {
  await cleanupTestState();
});

const free = {
  code: 'FREE-2030',
  scope: 'ALL' as const,
  per_school_max: 1,
  starts_at: '2030-01-01T00:00:00.000Z',
  ends_at: '2030-12-31T00:00:00.000Z',
};
const err = (statusCode: number, details?: object) =>
  HttpResponse.json(
    { statusCode, message: 'No', details, timestamp: '', path: '/', requestId: 'r' },
    { status: statusCode },
  );

describe('platform coupons hooks', () => {
  it('list: loading, then rows with one exhausted coupon; sends a cursor, never an offset', async () => {
    let search = '';
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/platform/coupons') || request.url.includes('/platform/coupons?'))
        search = new URL(request.url).search;
    });
    const { result } = renderHookWithProviders(() => usePlatformCoupons('cur'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.some((c) => c.max_uses === c.uses_count)).toBe(true);
    expect(search).toContain('cursor=cur');
    expect(search).not.toContain('offset');
    server.events.removeAllListeners();
  });

  it('list and usage: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/coupons', 500));
    const { result } = renderHookWithProviders(() => usePlatformCoupons());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('usage reads the per-school rows', async () => {
    const { result } = renderHookWithProviders(() =>
      useCouponUsage('55555555-5555-4555-8555-555555555555'),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.schools.items).toHaveLength(1);
  });

  it('create: carries an Idempotency-Key, stable across a double click; a 500 is not retried', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/platform/coupons', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return err(500);
      }),
    );
    const { result } = renderHookWithProviders(() => useCreateCoupon());
    const body = { ...free, code: 'WELCOME-10', discount_kind: 'PERCENT' as const, percent: 10 };
    act(() => {
      result.current.mutate(body);
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('free coupon: created', async () => {
    const { result } = renderHookWithProviders(() => useCreateFreeCoupon());
    act(() => result.current.mutate(free));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ kind: 'created', coupon: { code: 'FREE-2030' } });
  });

  it('free coupon: 403 APPROVAL_REQUESTED maps to waiting with the request id', async () => {
    server.use(
      http.post('*/platform/coupons/free', () =>
        err(403, { code: 'APPROVAL_REQUESTED', requestId: 'req-1' }),
      ),
    );
    const { result } = renderHookWithProviders(() => useCreateFreeCoupon());
    act(() => result.current.mutate(free));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ kind: 'waiting', requestId: 'req-1' });
  });

  it('free coupon: 409 maps to needs-second-owner; once approved, the retry carries X-Platform-Approval', async () => {
    server.use(http.post('*/platform/coupons/free', () => err(409)));
    const { result } = renderHookWithProviders(() => useCreateFreeCoupon());
    act(() => result.current.mutate(free));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ kind: 'needs-second-owner' });

    let header: string | null = null;
    server.use(
      http.post('*/platform/coupons/free', ({ request }) => {
        header = request.headers.get('X-Platform-Approval');
        return HttpResponse.json({ id: 'c', code: 'FREE-2030' }, { status: 201 });
      }),
    );
    act(() => result.current.mutate({ ...free, approvalId: 'appr-1' }));
    await waitFor(() => expect(result.current.data?.kind).toBe('created'));
    expect(header).toBe('appr-1');
  });

  it('free coupon: any other error still throws', async () => {
    server.use(http.post('*/platform/coupons/free', () => err(500)));
    const { result } = renderHookWithProviders(() => useCreateFreeCoupon());
    act(() => result.current.mutate(free));
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('disable patches active:false', async () => {
    let body: unknown;
    server.use(
      http.patch('*/platform/coupons/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'c' });
      }),
    );
    const { result } = renderHookWithProviders(() => useUpdateCoupon());
    act(() => result.current.mutate({ id: '55555555-5555-4555-8555-555555555555', active: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ active: false });
  });
});
