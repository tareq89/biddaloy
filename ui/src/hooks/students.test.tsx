import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { studentFactory, type Student } from '../test/factories';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import { studentKeys, useCreateStudent, useStudent, useStudents } from './students';
import { switchActiveTenant } from './tenant';

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
