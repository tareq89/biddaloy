import { createRootRoute, createRoute, Link, Outlet } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureRouteError } from '../api/sentry';
import { renderWithRouter } from '../test/render-with-router';

import { RouteErrorFallback } from './route-error-boundary';

vi.mock('../api/sentry', () => ({
  captureRouteError: vi.fn(),
}));

function BrokenPage(): React.ReactNode {
  throw new Error('Dues page exploded');
}

/** [8.12.1]: what axios throws when the server is unreachable — no HTTP
 * status, no response, just `code`. */
function NetworkErrorPage(): React.ReactNode {
  throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
}

/** [8.12.1]: what the browser throws when a lazily-imported route chunk
 * cannot be fetched — the shape of navigating to an uncached route with no
 * connection. Message wording differs per engine; this is Chrome's. */
function UncachedRoutePage(): React.ReactNode {
  throw new Error('Failed to fetch dynamically imported module: /assets/students-Bv7carHk.js');
}

/** jsdom reports `navigator.onLine === true`; this flips it for the
 * duration of a test. Returns the restore function. */
function goOffline(): () => void {
  // Shadows the `Navigator.prototype` getter with an own property; the
  // prototype itself is untouched, so restoring is a plain delete.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  return () => {
    Reflect.deleteProperty(navigator, 'onLine');
  };
}

function buildRouteTree(brokenComponent: () => React.ReactNode = BrokenPage) {
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
    component: brokenComponent,
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

  it('renders the offline state, and reports nothing, for an uncached route while offline', async () => {
    const restore = goOffline();
    try {
      renderWithRouter(buildRouteTree(UncachedRoutePage), { initialEntries: ['/broken'] });

      // `role="status"`, not `role="alert"` — losing signal is not an
      // application fault, so it neither interrupts a screen reader nor
      // opens a Sentry issue per tunnel.
      expect(await screen.findByRole('status')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: /offline/i })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(captureRouteError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('renders the offline state for an axios ERR_NETWORK even when `navigator.onLine` lies', async () => {
    // The captive-portal case: the OS reports a connection, every request
    // still fails.
    renderWithRouter(buildRouteTree(NetworkErrorPage), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(captureRouteError).not.toHaveBeenCalled();
  });

  it('still reports a genuine crash that happens to occur while offline', async () => {
    // The regression this guards: classifying by connectivity alone turned
    // every bug hit in a lift into "check your connection" — a retry that
    // can never work, and a Sentry issue that never opened.
    const restore = goOffline();
    try {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      expect(captureRouteError).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('does not treat a chunk load failure as offline while online (a deploy replaced it)', async () => {
    // Same throw, connection intact: this is stale-tab-after-deploy, which
    // [8.12.2]'s update prompt owns. Showing "you're offline" would be a
    // lie, and swallowing it would hide a broken deploy.
    renderWithRouter(buildRouteTree(UncachedRoutePage), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(captureRouteError).toHaveBeenCalledTimes(1);
  });

  it('still reports a genuine error while online', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(captureRouteError).toHaveBeenCalledTimes(1);
  });

  it('offers a retry from the offline state too', async () => {
    const restore = goOffline();
    try {
      renderWithRouter(buildRouteTree(UncachedRoutePage), { initialEntries: ['/broken'] });

      await screen.findByRole('status');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Go home' })).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('is axe clean offline as well as errored', async () => {
    const restore = goOffline();
    try {
      const { container } = renderWithRouter(buildRouteTree(UncachedRoutePage), {
        initialEntries: ['/broken'],
      });

      await screen.findByRole('status');
      await expect(container).toHaveNoViolations();
    } finally {
      restore();
    }
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    await screen.findByRole('alert');
    await expect(container).toHaveNoViolations();
  });
});
