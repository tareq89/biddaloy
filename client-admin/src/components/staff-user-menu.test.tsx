import { cleanupTestState, renderWithRouter, server, userResponseFactory } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffUserMenu } from './staff-user-menu';

// `useInstallPrompt`'s real mode comes from `install-prompt-store.ts`'s
// module-level `beforeinstallprompt` capture, which nothing in a jsdom
// test ever fires — mocking the hook directly is the only way to drive
// `mode: 'prompt'` / `'ios-instructions'` here. `IosInstallSheet` stays
// the real component (via `importActual`) so its own rendering is still
// exercised end to end through `StaffUserMenu`.
const { useInstallPromptMock } = vi.hoisted(() => ({ useInstallPromptMock: vi.fn() }));
vi.mock('@biddaloy/ui/pwa', async (importActual) => ({
  ...(await importActual<typeof import('@biddaloy/ui/pwa')>()),
  useInstallPrompt: useInstallPromptMock,
}));

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
  const securityRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/security',
    component: () => <p data-testid="security-page" />,
  });
  return rootRoute.addChildren([indexRoute, loginRoute, securityRoute]);
}

afterEach(async () => {
  await cleanupTestState();
});

// Every pre-existing test in this file predates the install item and
// doesn't care about it — default to `mode: 'none'` (nothing renders) so
// they keep asserting only what they already assert. Tests that care
// override this per-case with `useInstallPromptMock.mockReturnValue(...)`.
beforeEach(() => {
  useInstallPromptMock.mockReset().mockReturnValue({
    mode: 'none',
    install: vi.fn(),
    hintDismissed: true,
    dismissHint: vi.fn(),
  });
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

  it('navigates to /security when the Security item is activated (12.8)', async () => {
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
    await user.click(await screen.findByRole('menuitem', { name: 'Security' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/security'));
  });

  it('[15.8.3] omits the install item when useInstallPrompt reports mode "none"', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );
    // Already the `beforeEach` default; set explicitly for clarity/intent.
    useInstallPromptMock.mockReturnValue({
      mode: 'none',
      install: vi.fn(),
      hintDismissed: true,
      dismissHint: vi.fn(),
    });

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await screen.findByRole('menuitem', { name: /Sign out/ });

    expect(screen.queryByRole('menuitem', { name: /Install app/ })).toBeNull();
  });

  it('[15.8.3] calls install() when the install item is activated in "prompt" mode', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );
    const install = vi.fn().mockResolvedValue('accepted');
    useInstallPromptMock.mockReturnValue({
      mode: 'prompt',
      install,
      hintDismissed: true,
      dismissHint: vi.fn(),
    });

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Install app/ }));

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('[15.8.3] opens the iOS instructions sheet instead of calling install() in "ios-instructions" mode', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Rahim Uddin' })),
      ),
    );
    const install = vi.fn();
    useInstallPromptMock.mockReturnValue({
      mode: 'ios-instructions',
      install,
      hintDismissed: true,
      dismissHint: vi.fn(),
    });

    const user = userEvent.setup();
    renderWithRouter(buildRouteTree(), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Install app/ }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(install).not.toHaveBeenCalled();
  });
});
