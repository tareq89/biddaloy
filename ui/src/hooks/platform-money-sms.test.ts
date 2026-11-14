import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useCreateSmsPackage,
  useDeleteSmsStock,
  usePlatformSmsBalance,
  usePlatformSmsPackages,
  usePlatformSmsReport,
  usePlatformSmsStock,
  useRecordSmsStock,
  useSetSmsPackageActive,
} from './platform-money-sms';

afterEach(async () => {
  await cleanupTestState();
});

const stock = { boughtOn: '2029-12-01', smsCount: 1000, costTaka: 100 };

describe('platform money SMS hooks', () => {
  it('report: loading, then all four action lines; sends limit and the report cursor `after`', async () => {
    let query = '';
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/platform/money/sms')) query = new URL(request.url).search;
    });
    const { result } = renderHookWithProviders(() => usePlatformSmsReport('abc'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.actionLines.map((l) => l.code)).toEqual([
      'TOP_UP_NOW',
      'SCHOOLS_LOW',
      'SMS_EXPIRING',
      'OVERSOLD',
    ]);
    expect(query).toContain('after=abc');
    expect(query).toContain('limit=25');
    expect(query).not.toContain('offset');
    server.events.removeAllListeners();
  });

  it('report: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/money/sms', 500));
    const { result } = renderHookWithProviders(() => usePlatformSmsReport());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('packages, stock and balance read their lists', async () => {
    const pk = renderHookWithProviders(() => usePlatformSmsPackages());
    const st = renderHookWithProviders(() => usePlatformSmsStock());
    const bal = renderHookWithProviders(() => usePlatformSmsBalance());
    await waitFor(() => expect(pk.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(st.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(bal.result.current.isSuccess).toBe(true));
    expect(pk.result.current.data?.some((p) => !p.active)).toBe(true);
    expect(bal.result.current.data?.stale).toBe(true);
  });

  it('record stock: a 500 is an ApiError, sent once (no auto-retry)', async () => {
    let calls = 0;
    server.use(
      http.post('*/platform/sms-stock', () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 500, message: 'Boom', timestamp: '', path: '/', requestId: 'r' },
          { status: 500 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useRecordSmsStock());
    act(() => result.current.mutate(stock));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it('record stock: the Idempotency-Key is the same across a double click', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('*/platform/sms-stock', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json({ id: 'x' }, { status: 201 });
      }),
    );
    const { result } = renderHookWithProviders(() => useRecordSmsStock());
    act(() => {
      result.current.mutate(stock);
      result.current.mutate(stock);
    });
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('create package: carries an Idempotency-Key; set-active posts the flag', async () => {
    let key: string | null = null;
    server.use(
      http.post('*/platform/sms-packages', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ id: 'p' }, { status: 201 });
      }),
    );
    const create = renderHookWithProviders(() => useCreateSmsPackage());
    act(() =>
      create.result.current.mutate({ name: 'A', smsCount: 100, validityDays: 30, priceTaka: 10 }),
    );
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(key).toBeTruthy();

    let body: unknown;
    server.use(
      http.post('*/platform/sms-packages/:id/active', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'p', active: false });
      }),
    );
    const toggle = renderHookWithProviders(() => useSetSmsPackageActive());
    act(() => toggle.result.current.mutate({ id: 'p', active: false }));
    await waitFor(() => expect(toggle.result.current.isSuccess).toBe(true));
    expect(body).toEqual({ active: false });
  });

  it('delete stock: sends the reason with DELETE; 404 is not retried', async () => {
    let calls = 0;
    server.use(
      http.delete('*/platform/sms-stock/:id', () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'Not found', timestamp: '', path: '/', requestId: 'r' },
          { status: 404 },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => useDeleteSmsStock());
    act(() =>
      result.current.mutate({ id: '22222222-2222-4222-8222-222222222222', reason: 'typo' }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(404);
    expect(calls).toBe(1);
  });
});
