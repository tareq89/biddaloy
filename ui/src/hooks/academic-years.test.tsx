import { ApprovalScope } from '@biddaloy/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { academicYearFactory, type AcademicYear } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import {
  cleanupTestState,
  createTestQueryClient,
  renderWithProviders,
} from '../test/render-with-providers';

import {
  academicYearKeys,
  useAcademicYear,
  useAcademicYears,
  useAcademicYearStats,
  useCloseYear,
  useCreateAcademicYear,
  useCreateNextYear,
  useReopenYear,
  useYearClosePreview,
  useYearReadiness,
  useYearRolloverPreview,
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

describe('year rollover hooks [69.4.02]', () => {
  const input = {
    name: '2027',
    start_date: '2027-01-01',
    end_date: '2027-12-31',
    include: ['classes' as const, 'terms' as const],
  };

  it('previews with include joined into one query value', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/v1/academic-years/:id/next/preview', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ target_year_id: null, skipped_staff: [] });
      }),
    );
    const { result } = renderHookWithProviders(() => useYearRolloverPreview('year-1', input), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(url?.searchParams.get('include')).toBe('classes,terms');
    expect(url?.searchParams.get('name')).toBe('2027');
  });

  it('stays idle when every block is unticked', () => {
    const { result } = renderHookWithProviders(
      () => useYearRolloverPreview('year-1', { ...input, include: [] }),
      { tenantId: 'tenant-1' },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('creates the next year with an Idempotency-Key header', async () => {
    let key: string | null = null;
    server.use(
      http.post('/api/v1/academic-years/:id/next', ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ target_year_id: 'year-2', skipped_staff: [] }, { status: 201 });
      }),
    );
    const { result } = renderHookWithProviders(() => useCreateNextYear('year-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(key).toBeTruthy();
    expect(result.current.data?.target_year_id).toBe('year-2');
  });
});

describe('year close hooks [69.4.02]', () => {
  it('reads the close preview and the readiness counts', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id/close-preview', () =>
        HttpResponse.json({ blocks: [], warnings: [], freezes: [{ table: 'exams', count: 3 }] }),
      ),
      http.get('/api/v1/academic-years/:id/readiness', () =>
        HttpResponse.json({ classes: 2, teacher_assignments: 0, committed_promotion_runs: 1 }),
      ),
    );
    const { result } = renderHookWithProviders(
      () => ({ preview: useYearClosePreview('year-1'), readiness: useYearReadiness('year-1') }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.readiness.isSuccess).toBe(true));
    expect(result.current.preview.data?.freezes[0]?.count).toBe(3);
    expect(result.current.readiness.data?.teacher_assignments).toBe(0);
  });

  it('close and reopen post to their own routes', async () => {
    const hits: string[] = [];
    server.use(
      http.post('/api/v1/academic-years/:id/:action', ({ params }) => {
        hits.push(String(params.action));
        return HttpResponse.json(academicYearFactory({ id: params.id as string }));
      }),
    );
    const { result } = renderHookWithProviders(
      () => ({ close: useCloseYear(), reopen: useReopenYear() }),
      { tenantId: 'tenant-1' },
    );
    result.current.close.mutate('year-1');
    await waitFor(() => expect(result.current.close.isSuccess).toBe(true));
    result.current.reopen.mutate('year-1');
    await waitFor(() => expect(result.current.reopen.isSuccess).toBe(true));
    expect(hits).toEqual(['close', 'reopen']);
  });
});

describe('close and reopen step-up approval scope', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function Harness() {
    const close = useCloseYear();
    const reopen = useReopenYear();
    return (
      <div>
        <button onClick={() => close.mutate('year-1')}>close</button>
        <button onClick={() => reopen.mutate('year-1')}>reopen</button>
        {(close.isSuccess || reopen.isSuccess) && <span data-testid="done">done</span>}
      </div>
    );
  }

  // The server guards both routes with ACADEMIC_YEAR_CLOSE and the OTP DTO rejects any other
  // scope with a 400, so a reopen that sent `academic_year.reopen` could never be approved.
  it.each(['close', 'reopen'] as const)('%s asks for and verifies ACADEMIC_YEAR_CLOSE', async (action) => {
    let attempt = 0;
    let otpScope: unknown;
    let verifyScope: unknown;
    server.use(
      http.post('/api/v1/academic-years/:id/:action', ({ params }) => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 403,
              message: 'Approval required',
              timestamp: new Date().toISOString(),
              path: `/academic-years/year-1/${String(params.action)}`,
              requestId: 'req-1',
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json(academicYearFactory({ id: params.id as string }));
      }),
      http.post('/api/v1/auth/step-up/otp/request', async ({ request }) => {
        otpScope = ((await request.json()) as { scope?: unknown }).scope;
        return HttpResponse.json({}, { status: 202 });
      }),
      http.post('/api/v1/auth/step-up', async ({ request }) => {
        verifyScope = ((await request.json()) as { scope?: unknown }).scope;
        return HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { locale: 'en', tenantId: 'tenant-1' });

    await user.click(screen.getByRole('button', { name: action }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByTestId('done');

    expect(otpScope).toBe(ApprovalScope.ACADEMIC_YEAR_CLOSE);
    expect(verifyScope).toBe(ApprovalScope.ACADEMIC_YEAR_CLOSE);
  });
});
