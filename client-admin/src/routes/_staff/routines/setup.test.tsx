import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
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

    expect((await screen.findAllByText('Morning')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Routine setup' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Shifts and periods', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Rooms' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Routine rules' })).toBeTruthy();
  });

  it('puts the selected tab in the URL and shows only that panel', async () => {
    mockCommonRoutes();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/routines/setup'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Rooms' }));

    expect(await screen.findByRole('heading', { name: 'No rooms yet' })).toBeTruthy();
    expect(screen.queryByText('Morning')).toBeNull();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'rooms' }));
  });

  it('opens the rules tab from ?tab=rules, and falls back to the first tab for a bad value', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/setup?tab=rules'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByRole('heading', { name: 'Routine rules' })).toBeTruthy();
  });

  it('an invalid tab shows the shifts and periods tab', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/setup?tab=nonsense'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect((await screen.findAllByText('Morning')).length).toBeGreaterThan(0);
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
    const shiftSelect = await screen.findByRole('combobox', { name: 'Shift' });
    await within(shiftSelect).findByText('Morning');
    await user.click(shiftSelect);
    await user.click(await screen.findByRole('option', { name: 'Afternoon' }));

    await within(screen.getByRole('combobox', { name: 'Shift' })).findByText('Afternoon');
  });
});
