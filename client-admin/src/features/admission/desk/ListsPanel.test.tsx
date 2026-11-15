import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ListsPanel } from './ListsPanel';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/rounds/$roundId', component: ListsPanel }),
]);

const counts = { OFFERED: 2, WAITING: 0, ADMITTED: 1, EXPIRED: 0 };
const list = (over: object) => ({
  id: 'l1',
  kind: 'MERIT',
  sequence: 1,
  order_by: 'MERIT',
  capacity: 10,
  act_by_date: '2020-01-01',
  activated_at: '2019-12-01T00:00:00Z',
  counts,
  members: [],
  ...over,
});

function setup(meritDeadline: string, seatsLeft = 5) {
  server.use(
    http.get('/api/v1/admission/intakes/r1/lists', () =>
      HttpResponse.json({
        seat_count: 10,
        seats_left: seatsLeft,
        lists: [
          list({ act_by_date: meritDeadline }),
          list({
            id: 'l2',
            kind: 'WAITING',
            sequence: 2,
            activated_at: null,
            act_by_date: '2099-01-01',
            counts: { ...counts, OFFERED: 0, WAITING: 3 },
          }),
        ],
      }),
    ),
  );
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1?step=waiting'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('ListsPanel', () => {
  it('activate is disabled before the previous deadline and says why', async () => {
    setup('2099-12-31');
    const button = await screen.findByRole('button', { name: 'Open this list' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('You can open this list after');
  });

  it('activate is enabled after the previous deadline when seats are free', async () => {
    setup('2020-01-01');
    const button = await screen.findByRole('button', { name: 'Open this list' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('activate is disabled with a reason when no seat is free', async () => {
    setup('2020-01-01', 0);
    const button = await screen.findByRole('button', { name: 'Open this list' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('No seat is free');
  });
});
