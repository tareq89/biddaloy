import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/auth/social/done', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // The server passes the sign-in's deep link back as `?redirect=` (social-auth.service.ts).
  it('takes a signed-in visitor to the page they were trying to reach', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=%2Fstudents'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('drops a redirect that leaves the app', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=//evil.com'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  /** Same fake-JWT shape as `__root.test.tsx`; the signature is never checked. */
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

  it('keeps the deep link for a 2-school visitor whose school is already picked', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('sends a 2-school visitor with no school picked to the picker, carrying the link', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-school'));
    expect(router.state.location.search).toEqual({ redirect: '/students' });
  });
});
