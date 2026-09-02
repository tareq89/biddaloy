import {
  cleanupTestState,
  errorHandler,
  guardianFactory,
  renderWithRouter,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/**
 * [8.14.4] `/portal/account` — exercised through the real route tree so
 * `portal.tsx`'s `RequireRole` guard and `AppShell` wire up the same way
 * `portal/fees.test.tsx` documents for itself.
 *
 * The STUDENT-never-calls-`/guardians/mine` assertion is the load-bearing
 * one this suite exists for — see this file's own test below.
 */
describe('/portal/account', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function renderAccount(role: 'PARENT' | 'STUDENT' = 'PARENT') {
    return renderWithRouter(routeTree, {
      initialEntries: ['/portal/account'],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
  }

  it('renders the profile, password, preferences and sign-out cards, and never issues a /guardians/mine request, for STUDENT', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Student' })),
      ),
    );
    let guardianRequests = 0;
    server.use(
      http.get('/api/v1/guardians/mine', () => {
        guardianRequests += 1;
        return HttpResponse.json(guardianFactory());
      }),
    );

    renderAccount('STUDENT');

    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Contact numbers' })).toBeNull();

    // Give any accidental fire-and-forget request a tick to land before
    // asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guardianRequests).toBe(0);
  });

  it('renders all five cards, including the guardian-contact card, for PARENT', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Parent' })),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
    );

    renderAccount('PARENT');

    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Contact numbers' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeTruthy();
  });

  it('renders zero <h1> while /users/me is pending', async () => {
    server.use(http.get('/api/v1/users/me', async () => new Promise(() => {})));

    renderAccount('PARENT');

    expect(await screen.findByText('Loading your account')).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });

  it('renders zero <h1> when /users/me errors', async () => {
    server.use(errorHandler('get', '/api/v1/users/me', 500));

    renderAccount('PARENT');

    expect(await screen.findByText(/Could not load your account/)).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });

  it('signs out and navigates to /login even when the server logout call fails', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Parent' })),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
      errorHandler('post', '/api/v1/auth/logout', 500),
    );

    const user = userEvent.setup();
    const { router } = renderAccount('PARENT');

    await screen.findByRole('heading', { level: 1, name: 'Account' });
    await user.click(await screen.findByRole('button', { name: /Sign out/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
