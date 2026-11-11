import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

const host = vi.hoisted(() => ({ cockpit: false }));
vi.mock('../cockpit-host', () => ({ isCockpitHost: () => host.cockpit }));

/** [98.4.01] The root guard on both hosts. */
describe('root beforeLoad: cockpit host', () => {
  afterEach(async () => {
    host.cockpit = false;
    await cleanupTestState();
  });

  it('app host: /sign-in redirects to /login', async () => {
    const { router } = renderWithRouter(routeTree, { initialEntries: ['/sign-in'], locale: 'en' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('cockpit host: unauthenticated visit redirects to /sign-in', async () => {
    host.cockpit = true;
    server.use(authHandlers.refreshFailure);
    const { router } = renderWithRouter(routeTree, { initialEntries: ['/schools'], locale: 'en' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
  });

  it.each(['/sign-in/forgot', '/sign-in/reset', '/owner-security/two-step'])(
    'cockpit host: %s stays put while signed out',
    async (path) => {
      host.cockpit = true;
      server.use(authHandlers.refreshFailure);
      const { router } = renderWithRouter(routeTree, { initialEntries: [path], locale: 'en' });
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
    },
  );

  it.each(['/dashboard', '/portal'])(
    'cockpit host: signed-in owner on %s goes to /schools',
    async (path) => {
      host.cockpit = true;
      const { router } = renderWithRouter(routeTree, {
        initialEntries: [path],
        accessToken: 'test-token',
        locale: 'en',
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/schools'));
    },
  );
});
