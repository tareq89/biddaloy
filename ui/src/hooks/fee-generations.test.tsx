import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  feeGenerationQueryOptions,
  feeGenerationsKeys,
  feeGenerationsQueryOptions,
  useFeeGeneration,
  useFeeGenerationBills,
  useFeeGenerations,
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
