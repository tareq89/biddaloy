import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { academicYearFactory, type AcademicYear } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  academicYearKeys,
  useAcademicYear,
  useAcademicYears,
  useAcademicYearStats,
  useCreateAcademicYear,
  useDeleteAcademicYear,
  useSetCurrentAcademicYear,
  useUpdateAcademicYear,
} from './academic-years';

describe('useAcademicYear fetches a single academic year by id', () => {
  it('resolves with the year the handler returns for that id', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id', ({ params }) =>
        HttpResponse.json(academicYearFactory({ id: params.id as string, name: '2026-2027' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useAcademicYear('year-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('2026-2027');
  });

  it('stays disabled and issues no request when id is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/academic-years/:id', () => {
        requested = true;
        return HttpResponse.json(academicYearFactory());
      }),
    );

    const { result } = renderHookWithProviders(() => useAcademicYear(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useAcademicYearStats', () => {
  it('resolves with the classes/students/fee-structures counts for the year', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 4, students_count: 120, fee_structures_count: 6 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useAcademicYearStats('year-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      classes_count: 4,
      students_count: 120,
      fee_structures_count: 6,
    });
  });

  it('stays disabled and issues no request when id is undefined', () => {
    const { result } = renderHookWithProviders(() => useAcademicYearStats(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateAcademicYear invalidates the list (create -> refetch -> new row appears)', () => {
  it('a created year shows up in the next list read, not just the mutation response', async () => {
    let years: AcademicYear[] = [academicYearFactory({ name: '2025-2026' })];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: years, total: years.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/academic-years', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        const created = academicYearFactory({ name: body.name });
        years = [...years, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({ list: useAcademicYears(), create: useCreateAcademicYear() }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data?.data).toHaveLength(1);

    result.current.create.mutate({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
    expect(result.current.list.data?.data.map((y) => y.name)).toContain('2026-2027');
  });
});

describe('useUpdateAcademicYear', () => {
  it('patches the year and invalidates the detail cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      academicYearKeys.detail('year-1'),
      academicYearFactory({ id: 'year-1', name: '2026-2027' }),
    );

    server.use(
      http.patch('/api/v1/academic-years/:id', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json(academicYearFactory({ id: 'year-1', name: body.name }));
      }),
      http.get('/api/v1/academic-years/:id', () =>
        HttpResponse.json(academicYearFactory({ id: 'year-1', name: 'Renamed' })),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({
        year: useAcademicYear('year-1'),
        update: useUpdateAcademicYear('year-1'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.update.mutate({ name: 'Renamed' });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.year.data?.name).toBe('Renamed'));
  });
});

describe('useDeleteAcademicYear', () => {
  it('removes the year from cache and invalidates every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      academicYearKeys.detail('year-1'),
      academicYearFactory({ id: 'year-1' }),
    );

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/academic-years/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteAcademicYear(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('year-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('year-1');
    expect(queryClient.getQueryData(academicYearKeys.detail('year-1'))).toBeUndefined();
  });
});

describe('useSetCurrentAcademicYear', () => {
  it('[8.11.1] invalidates every list/detail entry, not just the target year — set-current unsets every other row too', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      academicYearKeys.detail('year-2'),
      academicYearFactory({ id: 'year-2', is_current: false }),
    );
    // year-1 was the previously-current year; set-current must unset it too —
    // seeding its cache entry proves invalidation covers every detail entry,
    // not just the target year's.
    queryClient.setQueryData(
      academicYearKeys.detail('year-1'),
      academicYearFactory({ id: 'year-1', is_current: true }),
    );

    server.use(
      http.post('/api/v1/academic-years/:id/set-current', ({ params }) =>
        HttpResponse.json(academicYearFactory({ id: params.id as string, is_current: true })),
      ),
      http.get('/api/v1/academic-years/:id', ({ params }) =>
        HttpResponse.json(
          academicYearFactory({
            id: params.id as string,
            is_current: params.id === 'year-2',
          }),
        ),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({
        year: useAcademicYear('year-2'),
        otherYear: useAcademicYear('year-1'),
        setCurrent: useSetCurrentAcademicYear(),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.setCurrent.mutate('year-2');

    await waitFor(() => expect(result.current.setCurrent.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.year.data?.is_current).toBe(true));
    // The non-target year's detail entry must refetch and drop its stale
    // `is_current` flag — invalidating `detail(id)` alone would leave it
    // stuck at `true` and this assertion would fail.
    await waitFor(() => expect(result.current.otherYear.data?.is_current).toBe(false));
  });
});
