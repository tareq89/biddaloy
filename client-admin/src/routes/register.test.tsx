import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/register consent line (59.3.02)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const open = (locale: 'en' | 'bn') => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register'], locale });
  };

  it.each([
    ['en', ['Terms', 'Privacy policy', 'Data agreement']],
    ['bn', ['শর্তাবলি', 'গোপনীয়তা নীতি', 'তথ্য চুক্তি']],
  ] as const)('shows the three documents as buttons in %s', async (locale, names) => {
    open(locale);

    for (const name of names) {
      expect(await screen.findByRole('button', { name })).toBeTruthy();
    }
  });

  it('opening a document does not tick the checkbox', async () => {
    open('en');

    fireEvent.click(await screen.findByRole('button', { name: 'Terms' }));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });
});

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
