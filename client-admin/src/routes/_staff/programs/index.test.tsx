/**
 * [34.4.1] Programs list. `route-permissions.ts` (34.4.2's territory,
 * `client-admin/src/route-permissions.ts`) has no entry for this route
 * yet — going through the real `routeTree.gen.ts` would render `_staff.tsx`'s
 * fail-closed `AccessDeniedState` instead of this page for every role,
 * including ADMIN (see `_staff.tsx`'s "Fail-closed" comment). So this
 * builds its own single-route tree directly from the file's exported
 * `Route`, the same manual `getParentRoute`/`.update()` wiring
 * `routeTree.gen.ts` does for every route — bypassing the `_staff` layout
 * (and its permission gate) entirely, the same way
 * `-recompute-preview-dialog.test.tsx` bypasses it for a dialog. Once
 * 34.4.2 lands the permission map entries, this can switch to the
 * `renderWithRouter(routeTree, ...)` pattern every other `_staff` route's
 * test already uses (see `exams/index.test.tsx`).
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { Route as ProgramsIndexRoute } from './index';

function buildRouteTree() {
  const rootRoute = createRootRoute();
  ProgramsIndexRoute.update({
    id: '/',
    path: '/',
    getParentRoute: () => rootRoute,
  } as never);
  return rootRoute.addChildren([ProgramsIndexRoute]);
}

function program(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-1',
    name: 'Program',
    description: null,
    is_active: true,
    show_on_report_card: false,
    milestone_count: 0,
    active_enrollment_count: 0,
    ...overrides,
  };
}

describe('/programs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders seeded programs and hides archived ones by default', async () => {
    const active = program({ id: 'p-1', name: 'Reading Club', is_active: true });
    const archived = program({ id: 'p-2', name: 'Old Club', is_active: false });
    server.use(http.get('/api/v1/programs', () => HttpResponse.json([active, archived])));

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Reading Club');
    expect(screen.queryByText('Old Club')).toBeNull();
  });

  it('opens the create dialog on ?new=1', async () => {
    server.use(http.get('/api/v1/programs', () => HttpResponse.json([])));

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/?new=1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Add program' });
  });

  it('shows an archived program once "Show archived" is checked', async () => {
    const user = userEvent.setup();
    const archived = program({ id: 'p-2', name: 'Old Club', is_active: false });
    server.use(http.get('/api/v1/programs', () => HttpResponse.json([archived])));

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(screen.queryByText('Old Club')).toBeNull();
    await user.click(await screen.findByRole('checkbox', { name: 'Show archived' }));
    await screen.findByText('Old Club');
  });
});
