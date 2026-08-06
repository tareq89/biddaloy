import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useStudents } from '../hooks/students';
import { renderWithRouter } from '../test/render-with-router';

import { RequireRole } from './require-role';
import { useListUrlState } from './use-list-url-state';

/**
 * The reference routed page [8.4.5] exists to prove: URL-as-state, not
 * component state. Every filter/sort/page change goes through
 * `useListUrlState` — nothing here is `useState`. Deliberately local to
 * this test file rather than a real `ui/src/components` export — the
 * actual list pages are a future feature-module ticket's job; this is
 * the pattern reference, matching `payments.test.tsx`'s `PaymentForm`.
 */
function StudentsListRoute() {
  const [state, updateUrl] = useListUrlState({ limit: 10 });
  const { data } = useStudents({
    page: state.page,
    limit: state.limit,
    ...(state.filters.class_id ? { class_id: state.filters.class_id } : {}),
  });

  return (
    <div>
      <p>page: {state.page}</p>
      <p>class_id: {state.filters.class_id ?? 'none'}</p>
      <p>sort: {state.sort ?? 'none'}</p>
      <button onClick={() => updateUrl({ page: state.page + 1 })}>Next page</button>
      <button onClick={() => updateUrl({ filters: { class_id: 'class-9' } })}>
        Filter class-9
      </button>
      <button onClick={() => updateUrl({ sort: 'full_name' })}>Sort by name</button>
      <ul>
        {data?.data.map((student) => (
          <li key={student.id}>{student.full_name}</li>
        ))}
      </ul>
    </div>
  );
}

const routes: RouteObject[] = [
  { path: '/students', element: <StudentsListRoute /> },
  { path: '/forbidden', element: <p>Forbidden</p> },
  {
    path: '/reports',
    element: (
      <RequireRole allow={['ADMIN', 'ACCOUNTANT', 'EXECUTIVE']}>
        <p>Reports</p>
      </RequireRole>
    ),
  },
];

describe('mounting at an arbitrary URL with search params', () => {
  it('the route reads its initial state from the URL, not a default', async () => {
    renderWithRouter(routes, {
      initialEntries: ['/students?page=3&class_id=class-9'],
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(screen.getByText('page: 3')).toBeTruthy());
    expect(screen.getByText('class_id: class-9')).toBeTruthy();
  });
});

describe('filter, sort, and page changes are reflected in the URL', () => {
  it('clicking the page/filter/sort controls updates the URL, not just what renders', async () => {
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(screen.getByText('page: 1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(router.state.location.search).toContain('page=2'));

    fireEvent.click(screen.getByRole('button', { name: 'Filter class-9' }));
    await waitFor(() => expect(router.state.location.search).toContain('class_id=class-9'));

    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }));
    await waitFor(() => expect(router.state.location.search).toContain('sort=full_name'));

    // All three survive together — not overwriting each other.
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('class_id=class-9');
    expect(router.state.location.search).toContain('sort=full_name');
  });
});

describe('permission-gated routes redirect correctly per role', () => {
  it.each([
    ['ACCOUNTANT', true],
    ['EXECUTIVE', true],
    ['TEACHER', false],
  ] as const)('role=%s -> allowed=%s', async (role, allowed) => {
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/reports'],
      tenantId: 'tenant-1',
      role,
    });

    if (allowed) {
      await waitFor(() => expect(screen.getByText('Reports')).toBeTruthy());
      expect(router.state.location.pathname).toBe('/reports');
    } else {
      await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
      expect(router.state.location.pathname).toBe('/forbidden');
    }
  });

  it('redirects when no role is active at all', async () => {
    renderWithRouter(routes, { initialEntries: ['/reports'], tenantId: 'tenant-1' });

    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
  });
});

describe('back-navigation restores prior list state', () => {
  it('navigating back returns to the previous page/filter, not a reset one', async () => {
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/students?page=1', '/students?page=2&class_id=class-9'],
      initialIndex: 1,
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(screen.getByText('page: 2')).toBeTruthy());
    expect(screen.getByText('class_id: class-9')).toBeTruthy();

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() => expect(screen.getByText('page: 1')).toBeTruthy());
    expect(screen.getByText('class_id: none')).toBeTruthy();
  });
});

describe('an invalid search param falls back sensibly instead of crashing', () => {
  it('a non-numeric page falls back to page 1', async () => {
    renderWithRouter(routes, { initialEntries: ['/students?page=abc'], tenantId: 'tenant-1' });

    await waitFor(() => expect(screen.getByText('page: 1')).toBeTruthy());
  });

  it('a negative page falls back to page 1', async () => {
    renderWithRouter(routes, { initialEntries: ['/students?page=-5'], tenantId: 'tenant-1' });

    await waitFor(() => expect(screen.getByText('page: 1')).toBeTruthy());
  });
});
