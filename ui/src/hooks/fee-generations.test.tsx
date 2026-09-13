/**
 * [16.3.7] The four batch row-action hooks — request shape, and that a
 * success invalidates the generation/dues caches (`invalidateGeneration`'s
 * own comment on why the whole branch, not one variant).
 */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { feeDuesKeys } from './fee-dues';
import {
  feeGenerationsKeys,
  useDeleteFeeGeneration,
  usePatchFeeGeneration,
  useRemoveBatchStudent,
  useRemoveUncollected,
} from './fee-generations';

describe('usePatchFeeGeneration', () => {
  it('PATCHes the input body and invalidates the generation + dues caches', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/fees/generations/gen-1', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => usePatchFeeGeneration('gen-1'), {
      tenantId: 'tenant-1',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    result.current.mutate({
      period_start: '2026-10-01T00:00:00.000Z',
      due_date: '2026-10-10T00:00:00.000Z',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({
      period_start: '2026-10-01T00:00:00.000Z',
      due_date: '2026-10-10T00:00:00.000Z',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: feeGenerationsKeys.detail('gen-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: feeDuesKeys.lists() });
  });
});

describe('useDeleteFeeGeneration', () => {
  it('DELETEs the batch by id', async () => {
    let calledPath: string | undefined;
    server.use(
      http.delete('/api/v1/fees/generations/:id', ({ params }) => {
        calledPath = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteFeeGeneration(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate('gen-2');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledPath).toBe('gen-2');
  });
});

describe('useRemoveBatchStudent', () => {
  it('DELETEs the student sub-resource', async () => {
    let calledUrl: string | undefined;
    server.use(
      http.delete('/api/v1/fees/generations/:id/students/:studentId', ({ request }) => {
        calledUrl = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHookWithProviders(() => useRemoveBatchStudent(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ generationId: 'gen-3', studentId: 'stu-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl).toBe('/api/v1/fees/generations/gen-3/students/stu-1');
  });
});

describe('useRemoveUncollected', () => {
  it('POSTs and resolves the removed count', async () => {
    server.use(
      http.post('/api/v1/fees/generations/gen-4/remove-uncollected', () =>
        HttpResponse.json({ removed_count: 7 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useRemoveUncollected(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate('gen-4');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ removed_count: 7 });
  });
});
