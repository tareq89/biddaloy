import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
      // [8.9.10]: the guard treats a tenant with no resolved role as
      // unresolved, and `/students` now sits behind `_staff`'s role guard.
      role: 'ADMIN',
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
      role: 'ADMIN',
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

/** [8.9.5]: authenticated but no active tenant chosen yet — the second
 * half of `beforeLoad`'s guard, sitting right after the [8.9.3] one above. */
describe('root beforeLoad: unresolved-tenant redirect', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  /** `decodeAccessTokenMemberships` never checks a signature (see
   * `session.ts`'s own comment) — same fake-JWT shape as `session.test.ts`. */
  function fakeJwtWithMemberships(memberships: unknown): string {
    const payload = btoa(JSON.stringify({ memberships }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${payload}.signature`;
  }

  const twoSchools = [
    { tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview School' },
    { tenantId: 'tenant-2', role: 'TEACHER', name: 'Rose Valley School' },
  ];

  it('redirects an authenticated visit with 2+ memberships and no active tenant to /select-school', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-school'));
    expect(router.state.location.search).toEqual({ redirect: '/students' });
  });

  it('visiting /select-school directly does not redirect (no loop)', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Choose a school' })).toBeTruthy(),
    );
    expect(router.state.location.pathname).toBe('/select-school');
  });

  it('an authenticated visit with an active tenant already set renders the requested route, no redirect', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy());
    expect(router.state.location.pathname).toBe('/students');
  });

  /** A tenant is only half a resolved membership — the role must be one
   * `_staff.tsx`/`portal.tsx` actually accept, or the visitor would reach
   * `/`, get redirected by audience, and bounce between `/dashboard` and
   * `/portal` forever. An unsupported role (e.g. HEADMASTER) must count as
   * unresolved, same as no role at all. */
  it('redirects an authenticated visit with an active tenant but an unsupported role to /select-school', async () => {
    // A real (fake) multi-membership JWT, not a bare access-token string —
    // `select-school.tsx` decodes the token itself to auto-pick a *single*
    // membership, and a plain string would decode to zero memberships and
    // trigger its own logout-and-redirect-to-/login effect, which is a
    // different code path than the one under test here.
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      tenantId: 'tenant-1',
      role: 'HEADMASTER',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-school'));
    expect(router.state.location.search).toEqual({ redirect: '/students' });
  });

  /** The mirror image of the redirect *to* `/select-school` above: a
   * visitor who already has an active tenant has nothing left to resolve
   * on the picker, and `handleSelect`/the zero-or-one-membership effect
   * there both switch tenants with no confirmation dialog — reachable by
   * direct URL, this would let a resolved visitor bypass `TenantBar`'s
   * confirm-before-switch flow entirely. */
  it('a direct visit to /select-school with an active tenant already set redirects away, not to the picker', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // `/` is the role-aware redirect since [8.9.10], so a resolved staff
    // visitor lands on the staff dashboard rather than sitting on `/`.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

/** [8.9.5]: `RootLayout`'s `canManageSettings` (`useHasPermission`) and
 * `TenantBar`'s active tenant both read the same reactive `auth-state.ts`
 * subscription now — this is the integration test proving a `TenantBar`
 * switch actually reaches `RootLayout`'s nav, not just `TenantBar`'s own
 * chip (see the two components' own comments). */
describe('root layout nav: reactive to a tenant switch', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function fakeJwtWithMemberships(memberships: unknown): string {
    const payload = btoa(JSON.stringify({ memberships }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${payload}.signature`;
  }

  it('switching from an ADMIN membership to a TEACHER one removes the Settings nav item', async () => {
    const user = userEvent.setup();
    const memberships = [
      { tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview School' },
      { tenantId: 'tenant-2', role: 'TEACHER', name: 'Rose Valley School' },
    ];
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      accessToken: fakeJwtWithMemberships(memberships),
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Switch school' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rose Valley School' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Switch school' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull());
  });
});

/**
 * [8.14.5]: `RootLayout`'s `<RouteProgress>` is wired straight off
 * `router.state.isLoading` — see the plan's "plan correction 3" for why
 * `isLoading`, not `state.status`/`state.isTransitioning`. These tests
 * pin that wiring: active while a route's loader is genuinely still in
 * flight, inactive once it has settled.
 */
describe('RootLayout: RouteProgress wiring', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is active (aria-hidden="false") while a slow route loader is in flight', async () => {
    server.use(
      http.get('/api/v1/students', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/dashboard'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      accessToken: 'test-token',
      locale: 'en',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));

    act(() => {
      void router.navigate({ to: '/students' });
    });

    const progressbar = await screen.findByRole('progressbar', { hidden: true });
    await waitFor(() => expect(progressbar.getAttribute('aria-hidden')).toBe('false'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy());
    await waitFor(() => expect(progressbar.getAttribute('aria-hidden')).toBe('true'));
  });

  it('stays inactive (aria-hidden="true") when nothing is loading', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      accessToken: 'test-token',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy());
    const progressbar = screen.getByRole('progressbar', { hidden: true });
    expect(progressbar.getAttribute('aria-hidden')).toBe('true');
  });
});
