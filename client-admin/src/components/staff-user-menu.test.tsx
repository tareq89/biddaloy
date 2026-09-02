import { cleanupTestState, renderWithRouter, server, userResponseFactory } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { StaffUserMenu } from './staff-user-menu';

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: StaffUserMenu,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p data-testid="login-page" />,
  });
  return rootRoute.addChildren([indexRoute, loginRoute]);
}

afterEach(async () => {
  await cleanupTestState();
});

describe('StaffUserMenu', () => {
  it('renders the fetched name and role, with an inert profile placeholder', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    // `aria-disabled`, not `disabled`: the placeholder has to stay in the
    // menu's roving focus order, otherwise a screen-reader user never
    // reaches the row that tells them the feature is coming.
    const profileItem = screen.getByRole('menuitem', { name: /Profile/ });
    expect(profileItem.getAttribute('aria-disabled')).toBe('true');
    expect(profileItem.getAttribute('data-disabled')).toBeNull();
  });

  it('does not navigate or close when the profile placeholder is activated', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Profile/ }));

    // Still open, and Sign out still reachable — the placeholder swallowed
    // the activation rather than acting on it.
    expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeTruthy();
  });

  it('renders a graceful fallback while /users/me is loading', async () => {
    server.use(http.get('/api/v1/users/me', async () => new Promise(() => {})));

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));

    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeTruthy();
  });

  it('renders a graceful fallback and a working Sign out when /users/me 401s', async () => {
    server.use(http.get('/api/v1/users/me', () => HttpResponse.json({}, { status: 401 })));

    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    expect(await screen.findByText('Loading…')).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /Sign out/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('signs out and navigates to /login', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );

    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await screen.findByText('Rahim Uddin');

    await user.click(screen.getByRole('menuitem', { name: /Sign out/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
