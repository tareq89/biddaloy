/** [67.5.07] Manual-alert hooks — list params, send/withdraw invalidation, gated preview. */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../test/msw/server';
import { renderHookWithProviders } from '../../test/render-hook-with-providers';
import { cleanupTestState } from '../../test/render-with-providers';

import {
  useManualAlertPreview,
  useManualAlerts,
  useSendManualAlert,
  useWithdrawManualAlert,
} from './use-attention-manual';
import { useAttentionSummary } from './use-attention-queries';

const TENANT = { tenantId: 'tenant-1' };

afterEach(async () => {
  await cleanupTestState();
});

describe('manual alert hooks', () => {
  it('lists with page params', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('*/attention/manual', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const { result } = renderHookWithProviders(
      () => useManualAlerts({ page: 2, pageSize: 10 }),
      TENANT,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('page')).toBe('2');
    expect(params!.get('pageSize')).toBe('10');
  });

  it('send POSTs the body and refreshes the list and the attention summary', async () => {
    let body: unknown = null;
    let summaryCalls = 0;
    let listCalls = 0;
    server.use(
      http.post('*/attention/manual', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'a-1' });
      }),
      http.get('*/attention/manual', () => {
        listCalls += 1;
        return HttpResponse.json({ items: [], total: 0 });
      }),
      http.get('*/attention/summary', () => {
        summaryCalls += 1;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHookWithProviders(
      () => ({
        list: useManualAlerts(),
        send: useSendManualAlert(),
        summary: useAttentionSummary(),
      }),
      { ...TENANT, role: 'ADMIN' },
    );
    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const input = {
      audience: { roles: ['TEACHER' as const] },
      severity: 'WARNING' as const,
      title: 'T',
      body: 'B',
      expiresOn: '2026-10-12',
    };
    result.current.send.mutate(input);
    await waitFor(() => expect(listCalls).toBe(2));
    await waitFor(() => expect(summaryCalls).toBe(2));
    expect(body).toEqual(input);
  });

  it('withdraw sends DELETE to the id', async () => {
    let url = '';
    server.use(
      http.delete('*/attention/manual/:id', ({ request }) => {
        url = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHookWithProviders(() => useWithdrawManualAlert(), TENANT);
    result.current.mutate('abc');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(url.endsWith('/attention/manual/abc')).toBe(true);
  });

  it('preview skips an empty audience and fires once for a non-empty one', async () => {
    let calls = 0;
    server.use(
      http.post('*/attention/manual/preview', () => {
        calls += 1;
        return HttpResponse.json({ recipientCount: 7 });
      }),
    );
    const empty = renderHookWithProviders(() => useManualAlertPreview({ roles: [] }), TENANT);
    expect(empty.result.current.fetchStatus).toBe('idle');
    const full = renderHookWithProviders(
      () => useManualAlertPreview({ roles: ['TEACHER'] }),
      TENANT,
    );
    await waitFor(() => expect(full.result.current.data?.recipientCount).toBe(7));
    expect(calls).toBe(1);
  });
});
