import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useGrantSmsCredits, useSmsCredits } from './sms-credits';

describe('useSmsCredits', () => {
  it('resolves the tenant balance and ledger page', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get('page')).toBe('2');
        expect(params.get('limit')).toBe('5');
        return HttpResponse.json({
          metering: 'PLATFORM',
          available: 120,
          reserved: 10,
          ledger: { data: [], total: 0, page: 2, limit: 5, totalPages: 1 },
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useSmsCredits(2, 5), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.metering).toBe('PLATFORM');
    expect(result.current.data?.available).toBe(120);
  });

  it('surfaces a server error via isError, not a thrown exception', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json(apiErrorBody(500, 'Boom', '/api/v1/communications/sms-credits'), {
          status: 500,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useSmsCredits(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useGrantSmsCredits', () => {
  it('posts the grant and resolves the new balance', async () => {
    server.use(
      http.post('/api/v1/schools/:id/sms-credits', async ({ params, request }) => {
        const body = (await request.json()) as { units: number; reason: string };
        expect(params.id).toBe('school-1');
        expect(body.units).toBe(100);
        expect(body.reason).toBe('Initial top-up');
        return HttpResponse.json({ available: 100, reserved: 0 });
      }),
    );

    const { result } = renderHookWithProviders(() => useGrantSmsCredits('school-1'), {
      tenantId: 'tenant-1',
      role: 'SUPER_ADMIN',
    });

    result.current.mutate({ units: 100, reason: 'Initial top-up', idempotency_key: 'key-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ available: 100, reserved: 0 });
  });

  it('surfaces a server error via isError, not a thrown exception', async () => {
    server.use(
      http.post('/api/v1/schools/:id/sms-credits', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            'units must be a non-zero integer',
            '/api/v1/schools/school-1/sms-credits',
          ),
          {
            status: 400,
          },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useGrantSmsCredits('school-1'), {
      tenantId: 'tenant-1',
      role: 'SUPER_ADMIN',
    });

    result.current.mutate({ units: 0, reason: 'x', idempotency_key: 'key-2' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
