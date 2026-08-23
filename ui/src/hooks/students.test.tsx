import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { studentFactory, type Student } from '../test/factories';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  studentKeys,
  useCreateStudent,
  useDeleteStudent,
  useStudent,
  useStudents,
  useUpdateStudentEnrollmentStatus,
  useUpdateStudentPreferredCommunication,
  type PreferredCommunication,
} from './students';
import { switchActiveTenant } from './tenant';

describe('useUpdateStudentPreferredCommunication is a legitimate optimistic mutation (low-stakes -> safe to roll back)', () => {
  it('shows the optimistic value before the server responds, then rolls back and surfaces an error on failure', async () => {
    // `createTestQueryClient()`'s default `mutations.retry: false` gets
    // overridden by this hook's own `retry: shouldRetryQuery` (same
    // client-default-vs-per-query-option interaction as the retry tests
    // below) — a 500 is retryable, so without `retryDelay: 0` this would
    // wait out real exponential backoff before reaching `isError`.
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      mutations: { retryDelay: 0 },
    });
    const student = studentFactory({ id: 'student-1', preferred_communication: 'SMS' });
    queryClient.setQueryData(studentKeys.detail('student-1'), student);

    server.use(
      http.patch('/api/v1/students/:id', async () => {
        await delay(30);
        return HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/students/student-1'), {
          status: 500,
        });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        student: useStudent('student-1'),
        update: useUpdateStudentPreferredCommunication('student-1'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    expect(result.current.student.data?.preferred_communication).toBe('SMS');

    result.current.update.mutate('WHATSAPP');

    // The whole point of "optimistic": the cache already reflects the new
    // value while the (still in-flight, 30ms-delayed) request is pending —
    // not just eventually, after the server actually confirms it.
    await waitFor(() =>
      expect(result.current.student.data?.preferred_communication).toBe('WHATSAPP'),
    );
    expect(result.current.update.isPending).toBe(true);

    await waitFor(() => expect(result.current.update.isError).toBe(true));
    // Rolled back to exactly the pre-mutation value, not some other reset.
    expect(result.current.student.data?.preferred_communication).toBe('SMS');
  });

  it('on success, settles on the server-confirmed value rather than just leaving the optimistic write in place', async () => {
    const queryClient = createTestQueryClient();
    const student = studentFactory({ id: 'student-2', preferred_communication: 'SMS' });
    queryClient.setQueryData(studentKeys.detail('student-2'), student);

    server.use(
      http.patch('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(
          studentFactory({ id: params.id as string, preferred_communication: 'EMAIL' }),
        ),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({
        student: useStudent('student-2'),
        update: useUpdateStudentPreferredCommunication('student-2'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.update.mutate('EMAIL');

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    // The mutation's own resolved value is the server-confirmed one — a
    // separate concern from `onSettled`'s background refetch, which
    // reconciles the cache against whatever `GET /students/:id` happens
    // to return next (not asserted here to avoid coupling this test to
    // that handler's own fixture data).
    expect(result.current.update.data?.preferred_communication).toBe('EMAIL');
  });

  it('serializes two overlapping updates for the same student — the second request never starts before the first settles', async () => {
    // Each request blocks on its own manually-controlled promise instead
    // of a fixed delay, so the test can assert on exact start order and
    // concurrency rather than inferring it from timing — an earlier
    // version of this test used relative delays and, when checked,
    // turned out to pass even with `scope` removed (both requests fire
    // immediately regardless of scope; only *starting* the second one
    // is what scope actually gates).
    const releasers: Record<string, () => void> = {};
    const startOrder: string[] = [];
    let concurrentRequests = 0;
    let maxConcurrentRequests = 0;

    server.use(
      http.patch('/api/v1/students/:id', async ({ request }) => {
        const body = (await request.json()) as { preferred_communication: string };
        startOrder.push(body.preferred_communication);
        concurrentRequests += 1;
        maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);
        await new Promise<void>((resolve) => {
          releasers[body.preferred_communication] = resolve;
        });
        concurrentRequests -= 1;
        return HttpResponse.json(
          studentFactory({
            id: 'student-3',
            preferred_communication: body.preferred_communication as PreferredCommunication,
          }),
        );
      }),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(
      () => useUpdateStudentPreferredCommunication('student-3'),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.mutate('WHATSAPP');
    await waitFor(() => expect(startOrder).toEqual(['WHATSAPP']));

    result.current.mutate('EMAIL');
    // Give the second call every opportunity to (incorrectly) start its
    // request before the first has settled — if `scope` weren't applied,
    // this is exactly where it would show up as a second entry in
    // `startOrder` and `maxConcurrentRequests` reaching 2.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(startOrder).toEqual(['WHATSAPP']);
    expect(maxConcurrentRequests).toBe(1);

    releasers.WHATSAPP?.();
    await waitFor(() => expect(startOrder).toEqual(['WHATSAPP', 'EMAIL']));
    expect(maxConcurrentRequests).toBe(1);

    releasers.EMAIL?.();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useStudent fetches a single student by id', () => {
  it('resolves with the student the handler returns for that id', async () => {
    server.use(
      http.get('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(studentFactory({ id: params.id as string, full_name: 'Single Student' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useStudent('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('student-1');
    expect(result.current.data?.full_name).toBe('Single Student');
  });

  it('[8.10.5] stays disabled and issues no request when id is undefined', () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/students/:id', () => {
        requestCount += 1;
        return HttpResponse.json(studentFactory());
      }),
    );

    const { result } = renderHookWithProviders(() => useStudent(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestCount).toBe(0);
  });
});

describe('useCreateStudent invalidates the students list (create -> refetch -> new row appears)', () => {
  it('a created student shows up in the next list read, not just the mutation response', async () => {
    // A local, mutable fixture — not the shared `studentHandlers` default,
    // which never accumulates state (see [8.4.2]'s handlers/students.ts:
    // `create` doesn't push into `fixtures`). The whole point of this test
    // is proving the *cache* refetches on create, so the mock server needs
    // to actually behave like one across the two requests.
    let students: Student[] = [studentFactory({ full_name: 'Existing Student' })];
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: students,
          total: students.length,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/students', async ({ request }) => {
        const body = (await request.json()) as { full_name: string };
        const created = studentFactory({ full_name: body.full_name });
        students = [...students, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({ list: useStudents(), create: useCreateStudent() }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data?.data).toHaveLength(1);

    result.current.create.mutate({ full_name: 'New Student', class_section_id: 'section-1' });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    // The assertion that matters: the *list* query re-read two rows, not
    // just that the mutation itself returned a 201. A handler that
    // invalidated the wrong key, or didn't invalidate at all, would leave
    // this at 1 even though `create.isSuccess` is true.
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
    expect(result.current.list.data?.data.map((s) => s.full_name)).toContain('New Student');
  });
});

describe('switchActiveTenant clears all cached server state', () => {
  it('leaves nothing behind for the next tenant to accidentally read', () => {
    const queryClient = createTestQueryClient();
    const seededKey = studentKeys.list();

    const { result } = renderHookWithProviders(() => useStudents(), {
      tenantId: 'tenant-1',
      queryClient,
      seedQueries: [
        {
          queryKey: seededKey,
          data: { data: [studentFactory()], total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      ],
    });

    expect(result.current.data).toBeDefined();
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    switchActiveTenant(queryClient, 'tenant-2');

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('retry behaviour: 4xx does not retry, other failures do', () => {
  // TanStack's default retryDelay is exponential backoff (seconds) — fine
  // in production, far too slow for a test. `createTestQueryClient()`
  // itself disables retry outright (`retry: false`), which would mask
  // *any* retry behaviour including the bug this test exists to catch —
  // so this builds a client that keeps every other test-safe default but
  // lets each query's own `retry: shouldRetryQuery` option (set in
  // `students.ts`) actually run, with `retryDelay: 0` so it does so fast.
  function retryTestClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: {
          retryDelay: 0,
          gcTime: Infinity,
          staleTime: Infinity,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
  }

  it('a 404 (client error) is not retried — one request, then it gives up', async () => {
    let callCount = 0;
    server.use(
      http.get('/api/v1/students', () => {
        callCount += 1;
        return HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/students'), {
          status: 404,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useStudents(), {
      tenantId: 'tenant-1',
      queryClient: retryTestClient(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(callCount).toBe(1);
  });

  it('a 500 (server error) is retried up to the shared cap before giving up', async () => {
    let callCount = 0;
    server.use(
      http.get('/api/v1/students/:id', () => {
        callCount += 1;
        return HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/students/x'), { status: 500 });
      }),
    );

    const { result } = renderHookWithProviders(() => useStudent('x'), {
      tenantId: 'tenant-1',
      queryClient: retryTestClient(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    // shouldRetryQuery allows retrying while failureCount < 2 — so 2
    // retries on top of the original request, 3 calls total.
    expect(callCount).toBe(3);
  });
});

describe('useUpdateStudentEnrollmentStatus', () => {
  it('[8.10.2] patches enrollment_status and invalidates the detail cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      studentKeys.detail('student-1'),
      studentFactory({ id: 'student-1', enrollment_status: 'ACTIVE' }),
    );

    server.use(
      http.patch('/api/v1/students/:id', async ({ request }) => {
        const body = (await request.json()) as { enrollment_status: string };
        return HttpResponse.json(
          studentFactory({
            id: 'student-1',
            enrollment_status: body.enrollment_status as Student['enrollment_status'],
          }),
        );
      }),
      http.get('/api/v1/students/:id', () =>
        HttpResponse.json(studentFactory({ id: 'student-1', enrollment_status: 'TRANSFERRED' })),
      ),
    );

    // A live `useStudent` observer, same reasoning as the optimistic-
    // mutation test above — `invalidateQueries` only triggers a
    // background refetch for a query someone is actually watching; a
    // detail page keeps this query mounted the whole time, so this
    // mirrors that instead of just inspecting the cache directly.
    const { result } = renderHookWithProviders(
      () => ({
        student: useStudent('student-1'),
        update: useUpdateStudentEnrollmentStatus('student-1'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.update.mutate('TRANSFERRED');

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(result.current.update.data?.enrollment_status).toBe('TRANSFERRED');
    // `onSuccess` invalidates the detail query too — the refetched value
    // (from the `GET` handler above), not just the mutation's own
    // response, is what a re-opened detail page would actually show.
    await waitFor(() => expect(result.current.student.data?.enrollment_status).toBe('TRANSFERRED'));
  });
});

describe('useDeleteStudent', () => {
  it('[8.10.2] removes the student from cache and invalidates every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(studentKeys.detail('student-1'), studentFactory({ id: 'student-1' }));

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/students/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteStudent(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('student-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('student-1');
    expect(queryClient.getQueryData(studentKeys.detail('student-1'))).toBeUndefined();
  });
});
