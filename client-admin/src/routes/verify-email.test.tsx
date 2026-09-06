import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/verify-email', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an honest state when the link has no token', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/verify-email'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('This link is missing its token.')).toBeTruthy());
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
});
