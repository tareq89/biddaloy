import {
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.4]'s standalone Guardians list — against the real route tree,
 * same reasoning as `students/index.test.tsx`'s own header comment.
 */
describe('/guardians', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists guardians with name, relationship, phone, preferred channel, linked students, and primary contact', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const guardian = guardianFactory({
      id: 'guardian-1',
      full_name: 'Abdul Karim',
      relationship: 'Father',
      phone: '+8801712345678',
      preferred_communication: 'SMS',
      is_primary_contact: true,
      students: [student],
    });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Abdul Karim')).toBeTruthy());
    expect(screen.getByText('Father')).toBeTruthy();
    expect(screen.getByText('+880 1712-345678')).toBeTruthy();
    expect(screen.getByText('SMS')).toBeTruthy();
    expect(screen.getByText('Karim Rahman')).toBeTruthy();
    expect(screen.getByText('Primary')).toBeTruthy();
  });

  it('shows a placeholder for a guardian with no students linked yet', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', is_primary_contact: false, students: [] });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Secondary')).toBeTruthy());
    // The Linked students column falls back to the empty-value placeholder
    // rather than an empty cell.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('debounces the search box before it changes the request', async () => {
    let requestedSearch: string | null = null;
    server.use(
      http.get('/api/v1/guardians', ({ request }) => {
        requestedSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const searchBox = await screen.findByRole('textbox', {
      name: 'Search by name, phone, or email',
    });
    await user.type(searchBox, 'Karim');

    // Immediately after typing, no search param has gone out yet.
    expect(requestedSearch).toBeNull();

    await waitFor(() => expect(requestedSearch).toBe('Karim'), { timeout: 1000 });
  });

  it('shows the empty message when no guardians match', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('No guardians found')).toBeTruthy());
  });

  it('renders a Bangla-script guardian name correctly', async () => {
    const guardian = guardianFactory({ id: 'guardian-1' }, 'bn');
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(guardian.full_name)).toBeTruthy());
  });

  it('View navigates to the guardian detail page', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/guardians/:id', ({ params }) =>
        HttpResponse.json(guardianFactory({ id: params.id as string, full_name: 'Abdul Karim' })),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'View' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guardians/guardian-1'));
  });

  it('is axe clean', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Abdul Karim');
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 2, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians?page=2'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Guardians' });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale — see
    // `data-table.tsx`'s pager `formatNumber` comment.
    await user.click(await screen.findByRole('option', { name: '২০' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 20, page: 1 }));
  });

  // [8.14.10]: server now accepts a `sort`/`order` param — clicking the
  // sortable "Name" column header writes it, replacing the old no-op
  // `onSortingChange`.
  it('clicking the Name column header writes sort/order to the URL', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Guardians' });
    await user.click(screen.getByRole('button', { name: 'Name' }));

    // `sort` carries the column's own id (`ListShellState.sorting.id`) — the
    // page maps that back onto `full_name` when building the query, not
    // when writing the URL.
    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.sort).toBe('name');
      expect(['asc', 'desc']).toContain(search.order);
    });
  });

  // [8.14.10]: a filter with no matching descriptor still renders as a
  // chip (`FilterBar`'s deep-linked-value guarantee) — here exercised via
  // `relationship`, and clearing it removes the URL param.
  it('an active relationship filter renders as a chip whose clear button removes it', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians?relationship=Father'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('region', { name: 'Guardians' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Remove filter: Relationship: Father/ }));

    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('relationship');
    });
  });
});
