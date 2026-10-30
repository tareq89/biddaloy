import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
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

  // The server's social callback sends `?social=<provider>` (social-auth.service.ts).
  it('shows "Continuing with Google" after the Google round trip', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register?social=google'], locale: 'en' });

    expect(await screen.findByText('Continuing with Google')).toBeTruthy();
  });

  it('says so when the social sign-up failed', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register?social=failed'], locale: 'en' });

    expect(await screen.findByText(/Signing up with that account did not work/)).toBeTruthy();
    expect(screen.queryByText(/Continuing with/)).toBeNull();
  });

  it('warns in the demo that the test inbox is public', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.get('/api/v1/demo/roles', () =>
        HttpResponse.json({ enabled: true, password: 'x', cards: [] }),
      ),
    );
    renderWithRouter(routeTree, { initialEntries: ['/register'], locale: 'en' });

    expect(await screen.findByText(/Do not enter a real phone number or email/)).toBeTruthy();
  });
});
