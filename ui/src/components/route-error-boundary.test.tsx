import { createRootRoute, createRoute, Link, Outlet } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureRouteError } from '../api/sentry';
import { renderWithRouter } from '../test/render-with-router';

import { RouteErrorFallback } from './route-error-boundary';

vi.mock('../api/sentry', () => ({
  captureRouteError: vi.fn(),
}));

function BrokenPage() {
  throw new Error('Dues page exploded');
}

function buildRouteTree() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/broken">Broken</Link>
        </nav>
        <Outlet />
      </>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>Home page</p>,
  });
  // Every top-level feature route sets its own `errorComponent` in the real
  // app only via `createRouter`'s `defaultErrorComponent`
  // (`client-admin/src/main.tsx`) — set directly here since this test
  // tree doesn't go through `createRouter` itself.
  const brokenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/broken',
    component: BrokenPage,
    errorComponent: RouteErrorFallback,
  });
  return rootRoute.addChildren([indexRoute, brokenRoute]);
}

describe('RouteErrorFallback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a recoverable state for the failing route while sibling nav (the shell) survives', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('alert')).toBeTruthy();
    // The root route's own nav — above the failing child route — is
    // untouched; only `/broken`'s own output was replaced.
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });

  it('reports the error to Sentry via captureRouteError', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    await screen.findByRole('alert');
    expect(captureRouteError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureRouteError).mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('offers a home affordance that navigates back to a sibling route', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Go home' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Home page')).toBeTruthy();
  });

  it('offers a retry affordance', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    await screen.findByRole('alert');
    await expect(container).toHaveNoViolations();
  });
});
