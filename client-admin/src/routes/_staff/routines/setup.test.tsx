import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SHIFT = {
  id: 'shift-1',
  name: 'Morning',
  day_starts_at: '08:00',
  day_ends_at: '13:00',
  sequence: 0,
};

function mockCommonRoutes() {
  server.use(
    http.get('*/routines/shifts', () =>
      HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('*/routines/shifts/shift-1/period-slots', () => HttpResponse.json([])),
    http.get('*/routines/rooms', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/schools/tenant-1/settings', () => HttpResponse.json({})),
  );
}

describe('/routines/setup', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders every setup panel and defaults to the first shift', async () => {
    mockCommonRoutes();

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/setup'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Morning')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThanOrEqual(0);
  });

  it('switches the selected shift when a different one is clicked', async () => {
    const SHIFT_2 = { ...SHIFT, id: 'shift-2', name: 'Afternoon', sequence: 1 };
    server.use(
      http.get('*/routines/shifts', () =>
        HttpResponse.json({ data: [SHIFT, SHIFT_2], total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('*/routines/shifts/shift-1/period-slots', () => HttpResponse.json([])),
      http.get('*/routines/shifts/shift-2/period-slots', () => HttpResponse.json([])),
      http.get('*/routines/rooms', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/schools/tenant-1/settings', () => HttpResponse.json({})),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/setup'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByText('Afternoon');
    await user.click(screen.getByRole('button', { name: 'Afternoon' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Afternoon' }).className).toMatch(/underline/),
    );
  });
});
