import { Permission, UserRole } from '@biddaloy/shared';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState } from '../test';
import { renderWithRouter } from '../test/render-with-router';

import { RequirePermission } from './require-permission';

const rootRoute = createRootRoute();
const gatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gated',
  component: () => (
    <RequirePermission permission={Permission.AUDIT_LOG_READ}>
      <p>Secret content</p>
    </RequirePermission>
  ),
});
const routeTree = rootRoute.addChildren([gatedRoute]);

describe('RequirePermission', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders children when the active role holds the permission', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/gated'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Secret content')).toBeTruthy());
  });

  it('renders the access-denied state, not children, when the role lacks the permission', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/gated'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: "You don't have access to this page." }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Secret content')).toBeNull();
  });

  it('never calls navigate — refusal renders in place, unlike RequireRole', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/gated'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: "You don't have access to this page." }),
      ).toBeTruthy(),
    );

    // Contract, not incidental: `RequirePermission` has no `useEffect` and
    // no `@tanstack/react-router` import at all, unlike `RequireRole`,
    // which redirects via an effect. Spy on the live router's own
    // `navigate` after the denied route has already mounted and settled —
    // if a future edit "helpfully" adds a redirect, this test catches it
    // even though nothing in this file calls `navigate` directly.
    const navigateSpy = vi.spyOn(router, 'navigate');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/gated');
  });

  it('calls onDenied only when the caller-supplied action button is clicked', async () => {
    const onDenied = vi.fn();
    const routeWithOnDenied = createRoute({
      getParentRoute: () => rootRoute,
      path: '/gated-with-action',
      component: () => (
        <RequirePermission permission={Permission.AUDIT_LOG_READ} onDenied={onDenied}>
          <p>Secret content</p>
        </RequirePermission>
      ),
    });
    const tree = rootRoute.addChildren([routeWithOnDenied]);

    renderWithRouter(tree, {
      initialEntries: ['/gated-with-action'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(onDenied).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(onDenied).toHaveBeenCalledTimes(1);
  });
});
