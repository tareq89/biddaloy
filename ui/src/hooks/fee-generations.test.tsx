/**
 * [16.3.5]/[16.3.7] — the generation list/detail/bills read hooks, plus
 * the four batch row-action mutation hooks appended by #656 at
 * integration (`invalidateGeneration`'s own comment explains why a
 * success invalidates the whole branch, not one variant).
 */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { feeDuesKeys } from './fee-dues';
import {
  feeGenerationQueryOptions,
  feeGenerationsKeys,
  feeGenerationsQueryOptions,
  useDeleteFeeGeneration,
  useFeeGeneration,
  useFeeGenerationBills,
  useFeeGenerations,
  usePatchFeeGeneration,
  useRemoveBatchStudent,
  useRemoveUncollected,
  type FeeGeneration,
  type PaginatedFeeGenerationBills,
  type PaginatedFeeGenerations,
} from './fee-generations';

function generationFactory(overrides: Partial<FeeGeneration> = {}): FeeGeneration {
  return {
    id: 'gen-1',
    academic_year_id: 'year-1',
    period_start: '2026-09-01T00:00:00.000Z',
    period_type: 'MONTH',
    due_date: '2026-09-10T00:00:00.000Z',
    source: 'MANUAL',
    duplicate_strategy: 'SKIP',
    notify_families: true,
    student_count: 40,
    generated_count: 38,
    skipped_count: 2,
    removed_count: 0,
    structures: [],
    created_at: '2026-09-01T08:00:00.000Z',
    billed_amount: 38000,
    collected_amount: 12000,
    collection_status: 'PARTIAL',
    generated_by: { id: 'user-1', full_name: 'Karim Rahman' },
    ...overrides,
  };
}

describe('feeGenerationsQueryOptions', () => {
  it('uses feeGenerationsKeys.list(filters) as its queryKey', () => {
    expect(feeGenerationsQueryOptions({ source: 'MANUAL' }).queryKey).toEqual(
      feeGenerationsKeys.list({ source: 'MANUAL' }),
    );
  });
});

describe('useFeeGenerations', () => {
  it('resolves the page of batches the handler returns', async () => {
    const body: PaginatedFeeGenerations = {
      data: [generationFactory()],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    server.use(http.get('/api/v1/fees/generations', () => HttpResponse.json(body)));

    const { result } = renderHookWithProviders(() => useFeeGenerations(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.id).toBe('gen-1');
  });

  it('serialises every filter field as a query param', async () => {
    const requested = new URLSearchParams();
    server.use(
      http.get('/api/v1/fees/generations', ({ request }) => {
        for (const [key, value] of new URL(request.url).searchParams) requested.set(key, value);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useFeeGenerations({
          period_from: '2026-09-01',
          period_to: '2026-09-30',
          fee_type: 'MONTHLY_TUITION',
          source: 'MANUAL',
          generated_by_user_id: 'user-1',
          collection_status: 'PARTIAL',
          page: 2,
          limit: 10,
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.fromEntries(requested)).toEqual({
      period_from: '2026-09-01',
      period_to: '2026-09-30',
      fee_type: 'MONTHLY_TUITION',
      source: 'MANUAL',
      generated_by_user_id: 'user-1',
      collection_status: 'PARTIAL',
      page: '2',
      limit: '10',
    });
  });
});

describe('feeGenerationQueryOptions', () => {
  it('uses feeGenerationsKeys.detail(id) as its queryKey', () => {
    expect(feeGenerationQueryOptions('gen-1').queryKey).toEqual(feeGenerationsKeys.detail('gen-1'));
  });

  it('is disabled when id is undefined', () => {
    expect(feeGenerationQueryOptions(undefined).queryKey).not.toEqual(
      feeGenerationsKeys.detail(undefined as unknown as string),
    );
  });
});

describe('useFeeGeneration', () => {
  it('resolves one batch by id', async () => {
    server.use(
      http.get('/api/v1/fees/generations/:id', ({ params }) =>
        HttpResponse.json(generationFactory({ id: params.id as string })),
      ),
    );

    const { result } = renderHookWithProviders(() => useFeeGeneration('gen-2'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('gen-2');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHookWithProviders(() => useFeeGeneration(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('feeGenerationBillsQueryOptions', () => {
  it('is disabled when batchId is undefined', () => {
    const { result } = renderHookWithProviders(() => useFeeGenerationBills(undefined), {
      tenantId: 'tenant-1',
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFeeGenerationBills', () => {
  it('resolves the paged bills for a batch and sends page/limit as query params', async () => {
    const requested = new URLSearchParams();
    const body: PaginatedFeeGenerationBills = {
      data: [
        {
          id: 'bill-1',
          student_id: 'student-1',
          student_full_name: 'Karim Rahman',
          student_registration_number: 'REG-1',
          class_name: 'Class 9',
          fee_name: 'Monthly tuition',
          amount: 1000,
          paid_amount: 0,
          status: 'PENDING',
          occurrence: '9/2026',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    server.use(
      http.get('/api/v1/fees/generations/:id/bills', ({ request }) => {
        for (const [key, value] of new URL(request.url).searchParams) requested.set(key, value);
        return HttpResponse.json(body);
      }),
    );

    const { result } = renderHookWithProviders(
      () => useFeeGenerationBills('gen-1', { page: 2, limit: 10 }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.student_full_name).toBe('Karim Rahman');
    expect(Object.fromEntries(requested)).toEqual({ page: '2', limit: '10' });
  });
});

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
