import '@biddaloy/ui/test';

import { ROLE_DEFAULT_LAYOUTS } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute, useSearch } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardPage } from './dashboard-page';

function TestRoute() {
  return <DashboardPage customize={useSearch({ strict: false }).customize === 1} />;
}

function tree() {
  const root = createRootRoute();
  const dash = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    validateSearch: (s: Record<string, unknown>) => ({
      customize: s.customize === 1 ? (1 as const) : undefined,
    }),
    component: TestRoute,
  });
  return root.addChildren([dash]);
}

function mockApi(opts: { preferences?: unknown; userStatus?: number } = {}) {
  server.use(
    http.get('/api/v1/users/me', () =>
      opts.userStatus
        ? HttpResponse.json({ message: 'boom' }, { status: opts.userStatus })
        : HttpResponse.json({ id: 'u1', full_name: 'Head', preferences: opts.preferences ?? null }),
    ),
    http.get('/api/v1/attention/summary', () =>
      HttpResponse.json({
        critical: 0,
        warning: 0,
        reminder: 0,
        activeTotal: 0,
        top: null,
        updatedAt: null,
        staleMinutes: 0,
      }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 6, totalPages: 1 }),
    ),
  );
}

const render = (url = '/dashboard') =>
  renderWithRouter(tree(), {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

describe('DashboardPage', () => {
  afterEach(cleanupTestState);

  it('renders the title and today, and the all-clear briefing', async () => {
    mockApi();
    render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
  });

  it('Customise goes to ?customize=1', async () => {
    mockApi();
    const { router } = render();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Customise' }))[0]!);
    expect(router.state.location.search).toMatchObject({ customize: 1 });
  });

  it('shows the Upcoming widget for a role with CALENDAR_READ', async () => {
    mockApi();
    render();
    expect((await screen.findAllByRole('heading', { name: 'Upcoming' })).length).toBeGreaterThan(0);
  });

  it('falls back to the role default when the prefs read fails', async () => {
    mockApi({ userStatus: 500 });
    render();
    expect((await screen.findAllByRole('heading', { name: 'Upcoming' })).length).toBeGreaterThan(0);
    expect(screen.queryByText('All widgets are hidden')).toBeNull();
  });

  it('a visible key with no component file renders nothing and no error', async () => {
    mockApi();
    render();
    await screen.findAllByRole('heading', { name: 'Upcoming' });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('all keys hidden -> EmptyState whose Customise goes to ?customize=1', async () => {
    mockApi({
      preferences: {
        dashboard: {
          ADMIN: { widgets: ROLE_DEFAULT_LAYOUTS.ADMIN.map((key) => ({ key, hidden: true })) },
        },
      },
    });
    const { router } = render();
    expect(await screen.findByText('All widgets are hidden')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Customise' });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(router.state.location.search).toMatchObject({ customize: 1 });
  });

  it('?customize=1 shows customise mode instead of the grid', async () => {
    mockApi();
    render('/dashboard?customize=1');
    expect(await screen.findByText('Customising')).toBeTruthy();
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
  });
});
