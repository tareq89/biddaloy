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
});
