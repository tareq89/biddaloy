import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { usePlatformVat, useRefundOrder, useUpdateVat } from './platform-billing';

afterEach(async () => {
  await cleanupTestState();
});

const ORDER = '66666666-6666-4666-8666-666666666666';
const SCHOOL = '77777777-7777-4777-8777-777777777777';

describe('platform billing money hooks', () => {
  it.each([
    ['seat', `/platform/billing/orders/${ORDER}/refund`],
    ['package', `/platform/billing/sms-bundle-orders/${ORDER}/refund`],
  ] as const)(
    'refund (%s): right route, stable Idempotency-Key across a double click',
    async (kind, path) => {
      const seen: { path: string; key: string | null }[] = [];
      server.events.on('request:start', ({ request }) => {
        if (request.method === 'POST')
          seen.push({
            path: new URL(request.url).pathname,
            key: request.headers.get('Idempotency-Key'),
          });
      });
      const { result } = renderHookWithProviders(() => useRefundOrder(SCHOOL, kind));
      act(() => {
        result.current.mutate({ orderId: ORDER, reason: 'duplicate' });
        result.current.mutate({ orderId: ORDER, reason: 'duplicate' });
      });
      await waitFor(() => expect(seen).toHaveLength(2));
      expect(seen[0]!.path).toBe(`/api/v1${path}`);
      expect(seen[0]!.key).toBeTruthy();
      expect(seen[0]!.key).toBe(seen[1]!.key);
      server.events.removeAllListeners();
    },
  );

  it('refund: a 409 is a mapped ApiError and is sent once', async () => {
    let calls = 0;
    server.use(
      http.post('*/platform/billing/sms-bundle-orders/:id/refund', () => {
        calls += 1;
        return HttpResponse.json(
          {
            statusCode: 409,
            message: 'Used',
            details: { code: 'BUNDLE_ALREADY_USED' },
            timestamp: '',
            path: '/',
            requestId: 'r',
          },
          { status: 409 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useRefundOrder(SCHOOL, 'package'));
    act(() => result.current.mutate({ orderId: ORDER, reason: 'x' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { statusCode: number }).statusCode).toBe(409);
    expect(calls).toBe(1);
  });

  it('vat: loading, then the setting; put sends the body', async () => {
    const get = renderHookWithProviders(() => usePlatformVat());
    expect(get.result.current.isLoading).toBe(true);
    await waitFor(() => expect(get.result.current.isSuccess).toBe(true));
    expect(get.result.current.data?.rate_percent).toBe(15);

    let body: unknown;
    server.use(
      http.put('*/platform/money/vat', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          enabled: false,
          rate_percent: null,
          label: 'VAT',
          registration: null,
        });
      }),
    );
    const put = renderHookWithProviders(() => useUpdateVat());
    act(() => put.result.current.mutate({ enabled: false }));
    await waitFor(() => expect(put.result.current.isSuccess).toBe(true));
    expect(body).toEqual({ enabled: false });
  });

  it('vat: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/money/vat', 500));
    const { result } = renderHookWithProviders(() => usePlatformVat());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
