import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useGlobalSearch } from './global-search';

describe('useGlobalSearch', () => {
  it('fetches nothing while the query is blank', async () => {
    const { result } = renderHookWithProviders(() => useGlobalSearch(''), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(result.current.students.isLoading).toBe(false);
    expect(result.current.students.data).toEqual([]);
    expect(result.current.guardians.data).toEqual([]);
    expect(result.current.teachers.data).toEqual([]);
    expect(result.current.invoices.data).toEqual([]);

    // Nothing above is async (every group is `enabled: false`), but
    // `useHasPermission`'s `useSyncExternalStore` subscription still
    // settles on a microtask after mount — letting it flush here keeps
    // this test's own state updates from spilling into whichever test
    // runs next.
    await waitFor(() => expect(result.current.students.isLoading).toBe(false));
  });

  it('composes students, guardians, teachers, and invoices once a query is given', async () => {
    const { result } = renderHookWithProviders(() => useGlobalSearch('ahmed'), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await waitFor(() => expect(result.current.students.data.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.guardians.data.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.teachers.data.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.invoices.data.length).toBeGreaterThan(0));
  });

  it("skips a group the active role can't read, without firing its request", async () => {
    let guardianCalls = 0;
    server.use(
      http.get('/api/v1/guardians', () => {
        guardianCalls += 1;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    // PARENT holds none of STUDENT_READ's list-view siblings here —
    // GUARDIAN_READ specifically — see `permissions.ts`'s ROLE_PERMISSIONS.
    const { result } = renderHookWithProviders(() => useGlobalSearch('ahmed'), {
      tenantId: 'tenant-1',
      role: 'PARENT',
    });

    await waitFor(() => expect(result.current.students.data.length).toBeGreaterThan(0));
    // PARENT holds INVOICE_READ too — let it settle before the test exits
    // so no state update lands after unmount.
    await waitFor(() => expect(result.current.invoices.data.length).toBeGreaterThan(0));
    expect(result.current.guardians.data).toEqual([]);
    expect(result.current.guardians.isLoading).toBe(false);
    expect(guardianCalls).toBe(0);
  });

  it('skips the teachers group for a role the server would reject too', async () => {
    const { result } = renderHookWithProviders(() => useGlobalSearch('ahmed'), {
      tenantId: 'tenant-1',
      role: 'PARENT',
    });

    expect(result.current.teachers.data).toEqual([]);
    expect(result.current.teachers.isLoading).toBe(false);
    // Lets PARENT's other enabled group (students, per its own
    // ROLE_PERMISSIONS entry) finish settling before the test exits —
    // otherwise its state update lands after unmount and React warns.
    await waitFor(() => expect(result.current.students.data.length).toBeGreaterThan(0));
  });
});
