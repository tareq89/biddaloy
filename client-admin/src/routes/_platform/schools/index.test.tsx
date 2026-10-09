import { UserRole } from '@biddaloy/shared';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const DAY = 86_400_000;
const TRIAL_ROWS = [
  {
    id: 's-run',
    name: 'Running School',
    slug: 'running',
    status: 'ACTIVE',
    created_at: '2026-01-15T00:00:00.000Z',
    country_code: 'BD',
    trial_ends_at: new Date(Date.now() + 12 * DAY).toISOString(),
    seat_limit: 50,
    status_reason: null,
  },
  {
    id: 's-end',
    name: 'Ended School',
    slug: 'ended',
    status: 'ACTIVE',
    created_at: '2026-01-15T00:00:00.000Z',
    country_code: 'BD',
    trial_ends_at: '2026-01-10T00:00:00.000Z',
    seat_limit: 50,
    status_reason: null,
  },
  {
    id: 's-none',
    name: 'Plain School',
    slug: 'plain',
    status: 'ACTIVE',
    created_at: '2026-01-15T00:00:00.000Z',
    country_code: 'BD',
    trial_ends_at: null,
    seat_limit: 50,
    status_reason: null,
  },
];

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
      name: 'Table of all schools on the platform',
    });
    await waitFor(() => expect(within(schoolsRegion).getAllByRole('row')).toHaveLength(3)); // header + 2 fixture rows
    const rows = within(schoolsRegion).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Ananta School')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Active')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Zenith School')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Suspended')).toBeTruthy();
    // Long-form date, never the bare locale string ("1/15/2026").
    expect(
      within(rows[1] as HTMLElement).getByText(formatDate('2026-01-15', REGION_BD_BN)),
    ).toBeTruthy();
  });

  it('has a primary "New school" button, a view link per row and no pager', async () => {
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByText('Ananta School');
    // `View Ananta School` is a row action; no previous/next pager exists.
    expect(screen.getAllByRole('link', { name: /^View .* School$/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    // The search field has a visible label.
    expect(screen.getByLabelText('Search schools')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New school' }));
    expect(await screen.findByRole('heading', { name: 'New school', level: 1 })).toBeTruthy();
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

    await screen.findByRole('heading', { name: 'Backup status' });
    const healthRegion = await screen.findByRole('region', {
      name: 'Table of backup status per school',
    });
    expect(within(healthRegion).getByText('Backup Health Fixture School A')).toBeTruthy();
    expect(within(healthRegion).getByText('Daily')).toBeTruthy();
    // The backup table sits under its own titled section.
    expect(screen.getByRole('heading', { name: 'Backup status', level: 2 })).toBeTruthy();
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
    // The empty list swaps the table for an EmptyState, so the busy region
    // disappears once the response lands.
    const schoolsRegion = screen.getByRole('region', {
      name: 'Table of all schools on the platform',
    });
    expect(schoolsRegion.getAttribute('aria-busy')).toBe('true');
    expect(await screen.findByText('No schools match your search.')).toBeTruthy();
  });

  it('shows the Trial column: days left, Ended, or empty', async () => {
    server.use(http.get('/api/v1/schools', () => HttpResponse.json(TRIAL_ROWS)));
    renderWithRouter(routeTree, {
      initialEntries: ['/schools'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    const region = await screen.findByRole('region', {
      name: 'Table of all schools on the platform',
    });
    const row = (name: string) =>
      within(within(region).getByText(name).closest('tr') as HTMLElement);
    await waitFor(() => expect(within(region).getByText('Running School')).toBeTruthy());
    // Region defaults to Bengali numerals regardless of UI locale.
    expect(row('Running School').getByText('১২ days left')).toBeTruthy();
    expect(row('Ended School').getByText('Ended')).toBeTruthy();
    expect(row('Plain School').queryByText(/left|Ended/)).toBeNull();
  });

  it('filters by trial through the URL and asks the server for it', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('/api/v1/schools', ({ request }) => {
        const trial = new URL(request.url).searchParams.get('trial');
        seen.push(trial);
        return HttpResponse.json(trial === 'expired' ? [TRIAL_ROWS[1]] : TRIAL_ROWS);
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/schools?trial=expired'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });

    await screen.findByText('Ended School');
    expect(screen.queryByText('Plain School')).toBeNull();
    expect(seen).toContain('expired');
  });
});
