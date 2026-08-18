import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [8.9.3]'s protected-route guard (`__root.tsx`'s `beforeLoad`), exercised
 * against the real route tree — not a synthetic one — since the guard's
 * whole job is deciding what every real route does before it renders.
 */
describe('root beforeLoad: protected-route redirect', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('redirects an unauthenticated visit to /login, preserving the intended destination', async () => {
    server.use(authHandlers.refreshFailure);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?page=2'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ redirect: '/students?page=2' });
  });

  it('an authenticated visit renders the requested route, no redirect', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      accessToken: 'test-token',
      locale: 'en',
    });

    // The heading, not `getByText` — the sidebar nav also has a "Students"
    // link, so a plain text query is ambiguous once both have rendered.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy());
    expect(router.state.location.pathname).toBe('/students');
  });

  it('an unauthenticated visit silently restores the session via a cold-boot refresh, no redirect', async () => {
    // No explicit accessToken, no server.use() override — relies entirely
    // on authHandlers.refresh being the default handler (a real returning
    // visitor with a still-valid refresh cookie), same as any other test
    // that renders a protected route without setting one explicitly.
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    // The heading, not `getByText` — the sidebar nav also has a "Students"
    // link, so a plain text query is ambiguous once both have rendered.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy());
    expect(router.state.location.pathname).toBe('/students');
  });

  it('visiting /login directly while unauthenticated does not redirect (no loop)', async () => {
    server.use(authHandlers.refreshFailure);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/login'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(router.state.location.pathname).toBe('/login');
  });
});
