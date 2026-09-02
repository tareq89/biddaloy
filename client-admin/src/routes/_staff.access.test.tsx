import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [8.14.17]'s per-role coverage of `_staff.tsx`'s `RequirePermission`
 * gate — the audit that motivated this ticket found a TEACHER's
 * `/fees/dues` rendering 46 students' payment balances and a TEACHER's
 * `/staff` rendering the whole staff directory including email
 * addresses, neither of which `TEACHER`'s `ROLE_PERMISSIONS` actually
 * grants. These cases are named explicitly rather than left to the
 * generic per-route matrix below, so a regression here has its own
 * failing test, not just a line in a larger table.
 *
 * Asserts on the access-denied heading and on `router.state.location`,
 * not on page content — a refused route must render *something* in
 * place, and must not navigate anywhere else while doing it.
 */
describe('_staff route access [8.14.17]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const ACCESS_DENIED_TITLE = "You don't have access to this page.";

  it("refuses a TEACHER at /fees/dues (previously rendered every student's balance)", async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    // Regression case the ticket calls out by name: a refused role stays
    // on the URL it visited, it is never bounced into a *different*
    // page — refusing in place, not redirecting to another privileged
    // route it also can't see.
    expect(router.state.location.pathname).toBe('/fees/dues');
  });

  it('refuses a TEACHER at /staff (previously rendered the whole directory, incl. emails)', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/staff');
  });

  it('renders /students for a TEACHER, who holds STUDENT_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
  });

  it('refuses an EXECUTIVE at /invoices, who holds no INVOICE_READ', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: UserRole.EXECUTIVE,
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(ACCESS_DENIED_TITLE)).toBeTruthy());
    expect(router.state.location.pathname).toBe('/invoices');
  });

  it('renders /students for an EXECUTIVE, who holds STUDENT_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.EXECUTIVE,
      locale: 'en',
    });

    await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
  });

  it.each(['/fees/dues', '/staff', '/invoices'] as const)(
    'renders %s for an ADMIN, who holds every permission',
    async (path) => {
      renderWithRouter(routeTree, {
        initialEntries: [path],
        tenantId: 'tenant-1',
        role: UserRole.ADMIN,
        locale: 'en',
      });

      await waitFor(() => expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull());
    },
  );

  it('fails closed when no role is active at all', async () => {
    // No role active never even reaches `RequirePermission` — or even
    // `_staff.tsx`'s outer `RequireRole` gate. `__root.tsx`'s own
    // `beforeLoad` guard is one layer earlier still: with no session to
    // resolve a role from, `ensureSessionLoaded()` reports unauthenticated
    // and the whole app redirects to `/login` before any staff route ever
    // matches. Still fail-closed, just at a higher gate: an unresolved
    // visitor never sees staff content either way.
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByText(ACCESS_DENIED_TITLE)).toBeNull();
  });
});
