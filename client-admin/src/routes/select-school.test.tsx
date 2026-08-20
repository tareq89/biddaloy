import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

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

describe('/select-school', () => {
  it('renders the picker for 2+ memberships and is axe clean', async () => {
    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Choose a school' })).toBeTruthy(),
    );
    expect(screen.getByRole('radio', { name: 'Greenview School, Admin' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Rose Valley School, Teacher' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('picking a school activates it and navigates to the originally-requested page', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Choose a school' });

    await user.click(screen.getByText('Rose Valley School'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('auto-activates a lone membership and navigates away without showing a picker', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships([twoSchools[0]]),
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('heading', { name: 'Choose a school' })).toBeNull();
  });

  it('logs out and redirects to /login for zero memberships, rather than looping', async () => {
    server.use(authHandlers.logout);
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships([]),
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
