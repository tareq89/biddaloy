import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureRouteError, recordRouteChunkFallback } from '../api/sentry';
import { renderWithRouter } from '../test/render-with-router';

import { RouteErrorFallback } from './route-error-boundary';

vi.mock('../api/sentry', () => ({
  captureRouteError: vi.fn(),
  recordRouteChunkFallback: vi.fn(),
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
 * cannot be fetched — offline on an uncached route, or a deploy that
 * deleted the chunk this tab is asking for.
 *
 * A real `TypeError`, not a plain `Error`, because that is what browsers
 * actually throw — and the distinction is not cosmetic. A plain `Error`
 * skipped the generic network-`TypeError` branch in `classifyRouteError`
 * entirely, so this fixture passed happily while [8.12.2]'s update fork
 * was unreachable in Chrome. Both shipped engine wordings are covered. */
function ChromeUncachedRoutePage(): React.ReactNode {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/students-Bv7carHk.js');
}

function FirefoxUncachedRoutePage(): React.ReactNode {
  throw new TypeError('error loading dynamically imported module: /assets/students-Bv7carHk.js');
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

function buildRouteTree(
  brokenComponent: () => React.ReactNode = BrokenPage,
  // [8.12.2]: lets a test pass props (the update fork's copy and reload
  // handler) that the router's own `errorComponent` slot cannot.
  errorComponent: (props: ErrorComponentProps) => React.ReactNode = RouteErrorFallback,
) {
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
    errorComponent,
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
      renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });

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

  it('renders the update state, not the offline one, for a chunk load failure while online', async () => {
    // Same throw, connection intact: this is stale-tab-after-deploy
    // ([8.12.2]). "You're offline" would be a lie, and a retry that
    // re-imports the same deleted chunk can only fail again — the way out
    // is a reload onto the new version.
    renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });

    // `role="status"`, not `role="alert"`: a routine deploy is no more the
    // app's fault than a tunnel is, and announcing it assertively
    // interrupts a screen-reader user mid-form.
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /newer version/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload to update' })).toBeTruthy();
    expect(screen.queryByText("You're offline")).toBeNull();
  });

  it("shows the update state for Firefox's wording too, not a generic error", async () => {
    // Firefox says "error loading dynamically imported module" where
    // Chrome says "Failed to fetch…". Missing the Firefox wording sent
    // every Firefox user, every deploy, down the generic error path —
    // complete with a Sentry issue apiece.
    renderWithRouter(buildRouteTree(FirefoxUncachedRoutePage), { initialEntries: ['/broken'] });

    expect(await screen.findByText(/older version/i)).toBeTruthy();
    expect(captureRouteError).not.toHaveBeenCalled();
  });

  it('shows the update state, not the offline state, for a real Chrome TypeError', async () => {
    // The regression that shipped past a green suite: Chrome throws a
    // `TypeError` whose message matches both the chunk-load pattern and
    // the generic network pattern. Checked in the wrong order, every
    // stale tab on Chrome read as "you're offline" and the retry button
    // re-imported the same deleted chunk forever.
    renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });

    expect(await screen.findByText(/older version/i)).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('does not report a deploy-replaced chunk to Sentry, but does leave a breadcrumb', async () => {
    // Same rationale as the offline fork: a deploy is not an application
    // fault, and one issue per user per deploy would bury real errors.
    // [8.12.7] settled that for good and added the breadcrumb, so the
    // *next* real error in the session still carries the trail.
    renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(captureRouteError).not.toHaveBeenCalled();
    expect(recordRouteChunkFallback).toHaveBeenCalledWith('update');
  });

  it('[8.12.7] leaves an offline-fork breadcrumb too, and none on the reported error path', async () => {
    const restore = goOffline();
    try {
      renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });
      expect(await screen.findByRole('status')).toBeTruthy();
      expect(recordRouteChunkFallback).toHaveBeenCalledWith('offline');
    } finally {
      restore();
    }

    vi.mocked(recordRouteChunkFallback).mockClear();
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(recordRouteChunkFallback).not.toHaveBeenCalled();
  });

  it('reloads through the caller-supplied handler from the update state', async () => {
    const user = userEvent.setup();
    const onReloadForUpdate = vi.fn();
    renderWithRouter(
      buildRouteTree(ChromeUncachedRoutePage, (props) => (
        <RouteErrorFallback {...props} onReloadForUpdate={onReloadForUpdate} />
      )),
      { initialEntries: ['/broken'] },
    );

    await user.click(await screen.findByRole('button', { name: 'Reload to update' }));
    expect(onReloadForUpdate).toHaveBeenCalledTimes(1);
  });

  it('accepts translated update copy', async () => {
    renderWithRouter(
      buildRouteTree(ChromeUncachedRoutePage, (props) => (
        <RouteErrorFallback
          {...props}
          updateMessage="নতুন সংস্করণ এসেছে"
          updateRetryLabel="রিলোড করুন"
          onReloadForUpdate={() => {}}
        />
      )),
      { initialEntries: ['/broken'] },
    );

    expect(await screen.findByText('নতুন সংস্করণ এসেছে')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'রিলোড করুন' })).toBeTruthy();
  });

  it('still reports a genuine error while online', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/broken'] });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(captureRouteError).toHaveBeenCalledTimes(1);
  });

  it('offers a retry from the offline state too', async () => {
    const restore = goOffline();
    try {
      renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), { initialEntries: ['/broken'] });

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
      const { container } = renderWithRouter(buildRouteTree(ChromeUncachedRoutePage), {
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
