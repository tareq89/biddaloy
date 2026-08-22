import { GUARDIAN_ROLES, UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [8.9.10]'s routing contract, the part that is easy to break silently:
 * `/` sends each audience to its own home, and neither audience can reach
 * the other's routes by typing a URL.
 *
 * These assert on `router.state.location.pathname` rather than on rendered
 * copy — the question here is *where the router landed*, and a page's text
 * changing (these are placeholders; Epic 5.0 replaces them) shouldn't make
 * a routing test fail.
 */
describe('role-aware routing [8.9.10]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function landingFor(role: UserRole): string {
    return (GUARDIAN_ROLES as readonly string[]).includes(role) ? '/portal' : '/dashboard';
  }

  // Every UserRole, not a sample: a role added later with no audience is
  // the failure this catches (`audiences.spec.ts` covers the same gap from
  // the enum's side).
  for (const role of Object.values(UserRole)) {
    it(`sends ${role} from / to ${landingFor(role)}`, async () => {
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/'],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });

      await waitFor(() => expect(router.state.location.pathname).toBe(landingFor(role)));
    });
  }

  it('redirects a PARENT who types a staff URL to the portal, instead of a 403 dead end', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: UserRole.PARENT,
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/portal'));
  });

  it('redirects an ADMIN who types a portal URL back to the staff dashboard', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/portal'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('keeps staff URLs where they were — the dashboard is the only one that moved', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });
});
