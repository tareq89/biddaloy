import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const ROWS = [
  {
    id: 's-1',
    name: 'Ananta School',
    status: 'ACTIVE',
    status_reason: null,
    deleted: false,
    seats_entitled: 100,
    seats_used: 100,
    paid_until: '2027-03-20',
    pending_orders: 1,
  },
  {
    id: 's-2',
    name: 'Zenith School',
    status: 'SUSPENDED',
    status_reason: 'IDLE',
    deleted: false,
    seats_entitled: 0,
    seats_used: 0,
    paid_until: null,
    pending_orders: 0,
  },
];

const render = (path = '/subscriptions') =>
  renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

describe('/subscriptions', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists every school with seats and paid-until', async () => {
    server.use(
      http.get('/api/v1/platform/billing/schools', () =>
        HttpResponse.json({ items: ROWS, total: 2 }),
      ),
    );
    render();

    const region = await screen.findByRole('region', {
      name: "Table of every school's seats and payments",
    });
    await waitFor(() => expect(within(region).getByText('Ananta School')).toBeTruthy());
    expect(within(region).getByText('Zenith School')).toBeTruthy();
    expect(within(region).getByText('Never paid')).toBeTruthy();
    expect(within(region).getByText('Suspended')).toBeTruthy();
  });

  it('asks the server for the filter named in the URL', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('/api/v1/platform/billing/schools', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('filter'));
        return HttpResponse.json({ items: [ROWS[1]], total: 1 });
      }),
    );
    render('/subscriptions?filter=idle');

    await screen.findByText('Zenith School');
    expect(seen).toContain('idle');
    expect(screen.queryByText('Ananta School')).toBeNull();
  });

  it('shows a load error sentence when the list fails', async () => {
    server.use(
      http.get('/api/v1/platform/billing/schools', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Could not load the subscriptions. Try again.')).toBeTruthy();
  });
});
