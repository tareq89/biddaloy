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
    // Scoped to the schools table's own region — [14.12.3] added a second
    // table (backup health) to this page, so an unscoped `getAllByRole`
    // would also pick up its rows.
    const schoolsRegion = await screen.findByRole('region', {
      name: 'Every school on the platform, with lifecycle status and creation date.',
    });
    await waitFor(() => expect(within(schoolsRegion).getAllByRole('row')).toHaveLength(3)); // header + 2 fixture rows
    const rows = within(schoolsRegion).getAllByRole('row');
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

  it('renders the backup health table, including a "Never" row for a school with no export', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Backup health' });
    const healthRegion = await screen.findByRole('region', {
      name: "Every school's backup schedule, most recent result and storage usage.",
    });
    expect(within(healthRegion).getByText('Backup Health Fixture School A')).toBeTruthy();
    expect(within(healthRegion).getByText('Daily')).toBeTruthy();
    const neverRow = within(healthRegion)
      .getByText('Backup Health Fixture School B')
      .closest('tr') as HTMLElement;
    expect(within(neverRow).getAllByText('Never')).toHaveLength(2);
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
    // Scoped to the schools table's own region — [14.12.3] added a second
    // table (backup health) to this page, so an unscoped `getByRole`
    // would throw on finding more than one region.
    const schoolsRegion = screen.getByRole('region', {
      name: 'Every school on the platform, with lifecycle status and creation date.',
    });
    expect(schoolsRegion.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(schoolsRegion.getAttribute('aria-busy')).toBe('false'));
  });
});
