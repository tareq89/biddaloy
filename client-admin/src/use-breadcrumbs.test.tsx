import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from './routeTree.gen';

/**
 * [30.3.3] — `use-breadcrumbs.ts` wired into the real `_staff.tsx` shell,
 * exercised through the real route tree (`routeTree.gen.ts`) rather than
 * a synthetic harness, same reasoning `$studentId.test.tsx`'s own header
 * comment gives: a hook whose whole job is reading real route matches
 * and a real react-query cache needs a real route tree and a real
 * (mocked-at-the-network-boundary) query, not a prop change.
 */
describe('useBreadcrumbs (wired into _staff.tsx)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a three-level route (students list · student · edit) builds three crumb items', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    const crumbItems = within(nav).getAllByRole('listitem');
    expect(crumbItems).toHaveLength(3);
    // Last crumb is the current page, rendered as text (`aria-current`),
    // not a link — `Breadcrumbs`' own contract.
    await waitFor(() => expect(within(nav).getByText('Rahim Uddin')).toBeTruthy());
  });

  it('a $param route shows the raw id before the entity loads, and the resolved name after', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    let resolveStudent!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveStudent = resolve;
    });
    server.use(
      http.get('/api/v1/students/:id', async () => {
        await gate;
        return HttpResponse.json(student);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    // Loader hasn't resolved yet — the dynamic crumb shows the raw id.
    await waitFor(() => expect(within(nav).getByText('student-1')).toBeTruthy());

    resolveStudent();

    await waitFor(() => expect(within(nav).getByText('Rahim Uddin')).toBeTruthy());
    expect(within(nav).queryByText('student-1')).toBeNull();
  });

  it('a route ROUTE_CRUMBS marks with no crumb reason yields an empty trail — no breadcrumb nav at all', async () => {
    vi.doMock('./route-crumbs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./route-crumbs')>();
      return {
        ...actual,
        ROUTE_CRUMBS: {
          ...actual.ROUTE_CRUMBS,
          '/_staff/dashboard': 'test: intentionally no crumb for this route',
        },
      };
    });
    vi.resetModules();
    const { routeTree: freshTree } = await import('./routeTree.gen');

    renderWithRouter(freshTree, {
      initialEntries: ['/dashboard'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();

    vi.doUnmock('./route-crumbs');
    vi.resetModules();
  });

  it("sets document.title from the trail, reversed and joined with ' · '", async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(document.title).toBe('Rahim Uddin · Students · Biddaloy'));
  });
});
