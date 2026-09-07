import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** #533's SUPER_ADMIN platform schools list. Every case renders as
 * SUPER_ADMIN — `_platform.access.test.tsx` already covers the role
 * gate itself. */
describe('/schools', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists schools with a status badge and created date', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Schools' });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3)); // header + 2 fixture rows
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Ananta School')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Active')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Zenith School')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Suspended')).toBeTruthy();
  });

  it('filters by name/slug client-side', async () => {
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByText('Ananta School');
    await user.type(screen.getByLabelText('Search schools'), 'zenith');

    await waitFor(() => expect(screen.queryByText('Ananta School')).toBeNull());
    expect(screen.getByText('Zenith School')).toBeTruthy();
  });

  it('shows an empty message when no school matches the search', async () => {
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByText('Ananta School');
    await user.type(screen.getByLabelText('Search schools'), 'no-such-school');

    await waitFor(() => expect(screen.getByText('No schools match your search.')).toBeTruthy());
  });

  it('shows a loading state while the list is in flight', async () => {
    const { server } = await import('@biddaloy/ui/test');
    server.use(
      http.get(
        '/api/v1/schools',
        () => new Promise((resolve) => setTimeout(() => resolve(HttpResponse.json([])), 50)),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Schools' });
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
  });
});
