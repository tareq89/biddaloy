import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useCreateSmsBundleOrder,
  useSmsBundleCatalog,
  useSmsBundleOrders,
  useSmsSource,
} from './sms-bundles';

const opts = { tenantId: 'tenant-1' };
const PKG = '00000000-0000-4000-8000-000000000101';

describe('sms-bundles queries', () => {
  it('loads, then resolves the catalog', async () => {
    const { result } = renderHookWithProviders(() => useSmsBundleCatalog(), opts);
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
  });

  it('pages orders by offset, limit capped at 100', async () => {
    let seen = '';
    server.use(
      http.get('/api/v1/sms-bundles/orders', ({ request }) => {
        seen = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(() => useSmsBundleOrders(3, 500), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(new URLSearchParams(seen).get('limit')).toBe('100');
    expect(new URLSearchParams(seen).get('offset')).toBe('200'); // page 3 starts after 2 full pages of 100
  });

  it('maps a server error onto isError', async () => {
    server.use(
      http.get('/api/v1/communications/sms-source', () =>
        HttpResponse.json(apiErrorBody(500, 'Boom', '/api/v1/communications/sms-source'), {
          status: 500,
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSmsSource(), opts);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateSmsBundleOrder', () => {
  it('does not retry a failed write, reuses the key on a manual retry, rotates after success', async () => {
    const keys: (string | null)[] = [];
    let calls = 0;
    server.use(
      http.post('/api/v1/sms-bundles/orders', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(apiErrorBody(500, 'Boom', '/api/v1/sms-bundles/orders'), {
            status: 500,
          });
        }
        return HttpResponse.json({ id: 'o1' }, { status: 201 });
      }),
    );
    const { result } = renderHookWithProviders(() => useCreateSmsBundleOrder(), opts);

    act(() => result.current.mutate({ package_id: PKG }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);

    act(() => result.current.mutate({ package_id: PKG }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);

    // a second order in the same mount is a new attempt
    act(() => result.current.mutate({ package_id: PKG }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('keeps a separate key per package in one mount', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/sms-bundles/orders', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(apiErrorBody(500, 'Boom', '/api/v1/sms-bundles/orders'), {
          status: 500,
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useCreateSmsBundleOrder(), opts);
    for (const id of [PKG, 'other-package', PKG]) {
      act(() => result.current.mutate({ package_id: id }));
      await waitFor(() => expect(result.current.isError).toBe(true));
      act(() => result.current.reset());
    }
    expect(keys).toHaveLength(3);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it('a reopened dialog (new mount) gets a new key', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/sms-bundles/orders', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(apiErrorBody(500, 'Boom', '/api/v1/sms-bundles/orders'), {
          status: 500,
        });
      }),
    );
    for (let i = 0; i < 2; i++) {
      const { result, unmount } = renderHookWithProviders(() => useCreateSmsBundleOrder(), opts);
      act(() => result.current.mutate({ package_id: PKG }));
      await waitFor(() => expect(keys).toHaveLength(i + 1));
      unmount();
    }
    expect(keys[1]).not.toBe(keys[0]);
  });
});
