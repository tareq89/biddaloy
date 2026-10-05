import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/verify-email', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an honest state when the link has no token', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/verify-email'], locale: 'en' });

    await waitFor(() =>
      expect(screen.getByText('This link is incomplete — ask for a new one.')).toBeTruthy(),
    );
  });

  it('shows the success card for a valid token', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.verifyEmail);

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=a-valid-verify-token'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Your email address has been updated.')).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows the expired-link state for an expired/consumed token', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.verifyEmailExpired);

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=an-expired-verify-token'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('This link has expired or has already been used.')).toBeTruthy(),
    );
  });

  it('a failed check shows a retry button that checks again', async () => {
    let calls = 0;
    server.use(
      authHandlers.refreshFailure,
      http.post('/api/v1/auth/verify-email', () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=a-valid-verify-token'],
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(calls).toBe(2));
  });
});
