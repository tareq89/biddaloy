/** [3.x/#3988] online-payments hooks: Idempotency-Key, no retry, staff filter, polling gate. */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useOnlinePaymentResult,
  useOnlinePaymentSubmissions,
  useStartOnlinePayment,
  useTestBkashConnection,
} from './online-payments';

afterEach(async () => {
  sessionStorage.clear();
  await cleanupTestState();
});

const opts = { tenantId: 'tenant-1' };

describe('useStartOnlinePayment', () => {
  it('sends the bill ids with an Idempotency-Key', async () => {
    let key: string | null = null;
    let body: unknown;
    server.use(
      http.post('/api/v1/portal/online-payments', async ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        body = await request.json();
        return HttpResponse.json({ id: 'o1', bkashUrl: 'https://pay.example/x' });
      }),
    );
    const { result } = renderHookWithProviders(() => useStartOnlinePayment(), opts);
    result.current.mutate(['b1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({ billIds: ['b1'] });
    expect(result.current.data?.bkashUrl).toBe('https://pay.example/x');
  });

  it('a failed start is not retried', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/portal/online-payments', () => {
        calls += 1;
        return HttpResponse.json({ message: 'down' }, { status: 503 });
      }),
    );
    const { result } = renderHookWithProviders(() => useStartOnlinePayment(), opts);
    result.current.mutate(['b1']);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe('useOnlinePaymentResult', () => {
  it('stays idle without an id', () => {
    const { result } = renderHookWithProviders(() => useOnlinePaymentResult(undefined), opts);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('reads the result by id', async () => {
    server.use(
      http.get('/api/v1/portal/online-payments/o1', () =>
        HttpResponse.json({ id: 'o1', status: 'COMPLETED', unmatched: false }),
      ),
    );
    const { result } = renderHookWithProviders(() => useOnlinePaymentResult('o1'), opts);
    await waitFor(() => expect(result.current.data?.status).toBe('COMPLETED'));
  });
});

describe('staff list and test connection', () => {
  it('lists with source=ONLINE', async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/payment-submissions', ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { result } = renderHookWithProviders(() => useOnlinePaymentSubmissions(), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(q?.get('source')).toBe('ONLINE');
  });

  it('test connection posts once and is not retried', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/settings/payments/bkash/test', () => {
        calls += 1;
        return HttpResponse.json({ message: 'bad' }, { status: 502 });
      }),
    );
    const { result } = renderHookWithProviders(() => useTestBkashConnection(), opts);
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});
