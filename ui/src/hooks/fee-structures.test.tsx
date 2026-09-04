import { FeeType } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  feeStructureFactory,
  feeStructureStudentFactory,
  type FeeStructure,
} from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  feeStructureKeys,
  useCreateFeeStructure,
  useDeleteFeeStructure,
  useFeeStructure,
  useFeeStructures,
  useUpdateFeeStructure,
} from './fee-structures';

describe('useFeeStructure fetches a single fee structure by id', () => {
  // Only the detail endpoint hydrates `selected_students`, so this is the
  // hook the edit dialog's student picker prefills from.
  it('resolves with the structure and its selected students', async () => {
    server.use(
      http.get('/api/v1/fee-structures/:id', ({ params }) =>
        HttpResponse.json({
          ...feeStructureFactory({ id: params.id as string }),
          selected_students: [feeStructureStudentFactory()],
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useFeeStructure('structure-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('structure-1');
    expect(result.current.data?.selected_students).toHaveLength(1);
  });

  it('stays disabled and issues no request when id is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/fee-structures/:id', () => {
        requested = true;
        return HttpResponse.json(feeStructureFactory());
      }),
    );

    const { result } = renderHookWithProviders(() => useFeeStructure(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useCreateFeeStructure', () => {
  it('adds the created structure to the invalidated list', async () => {
    let rows: FeeStructure[] = [feeStructureFactory({ id: 'structure-1' })];
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/fee-structures', async ({ request }) => {
        const bodyJson = (await request.json()) as { name: string };
        const created = feeStructureFactory({ id: 'structure-2', name: bodyJson.name });
        rows = [...rows, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({ list: useFeeStructures(), create: useCreateFeeStructure() }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    result.current.create.mutate({
      fee_type: 'EXAM_FEE',
      name: 'Exam fee',
      amount: 500,
      class_id: 'class-9',
      academic_year_id: 'year-1',
      month: 3,
    });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
  });
});

describe('useUpdateFeeStructure', () => {
  it('patches the structure and invalidates its detail cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      feeStructureKeys.detail('structure-1'),
      feeStructureFactory({ id: 'structure-1', name: 'Old name' }),
    );

    server.use(
      http.patch('/api/v1/fee-structures/:id', async ({ request }) => {
        const bodyJson = (await request.json()) as { name: string };
        return HttpResponse.json(feeStructureFactory({ id: 'structure-1', name: bodyJson.name }));
      }),
      http.get('/api/v1/fee-structures/:id', () =>
        HttpResponse.json(feeStructureFactory({ id: 'structure-1', name: 'Renamed' })),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({
        structure: useFeeStructure('structure-1'),
        update: useUpdateFeeStructure('structure-1'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.update.mutate({ name: 'Renamed' });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.structure.data?.name).toBe('Renamed'));
  });
});

describe('useDeleteFeeStructure', () => {
  it('drops the structure from cache and invalidates every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      feeStructureKeys.detail('structure-1'),
      feeStructureFactory({ id: 'structure-1' }),
    );

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/fee-structures/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteFeeStructure(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('structure-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('structure-1');
    expect(queryClient.getQueryData(feeStructureKeys.detail('structure-1'))).toBeUndefined();
  });
});

// [8.14.10]: `search`/`fee_type`/`section_id`/`is_recurring`/`sort`/`order`
// mirror `QueryFeeStructureDto`, landed server-side by #373 but never
// threaded through `FeeStructureListFilters` until now.
describe('useFeeStructures requests every QueryFeeStructureDto field', () => {
  it('sends search, fee_type, section_id, is_recurring, sort, and order as query params', async () => {
    const requested = new URLSearchParams();
    server.use(
      http.get('/api/v1/fee-structures', ({ request }) => {
        for (const [key, value] of new URL(request.url).searchParams) requested.set(key, value);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useFeeStructures({
          search: 'Tuition',
          fee_type: FeeType.MONTHLY_TUITION,
          section_id: 'section-1',
          is_recurring: true,
          sort: 'amount',
          order: 'desc',
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested.get('search')).toBe('Tuition');
    expect(requested.get('fee_type')).toBe('MONTHLY_TUITION');
    expect(requested.get('section_id')).toBe('section-1');
    expect(requested.get('is_recurring')).toBe('true');
    expect(requested.get('sort')).toBe('amount');
    expect(requested.get('order')).toBe('desc');
  });
});
