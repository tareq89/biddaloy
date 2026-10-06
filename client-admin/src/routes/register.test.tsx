import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/register', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends a signed-in visitor away instead of showing the sign-up card', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/register'));
  });

  it('shows the sign-up card to a signed-out visitor (public path, no bounce to /login)', async () => {
    server.use(authHandlers.refreshFailure);
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/register'],
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/register');
  });
});
