import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

async function setPassword(): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'a-strong-password');
  await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password');
  await user.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('/activate', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an honest state when the link has no token', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/activate'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('This link is missing its token.')).toBeTruthy());
  });

  it('renders the welcome heading and set-password form for a valid token', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.activateVerify);

    renderWithRouter(routeTree, {
      initialEntries: ['/activate?token=a-valid-invite-token-value'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Welcome, Rahima — Dhanmondi High School' }),
      ).toBeTruthy(),
    );
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });

  it('shows the expired-link state with a resend form', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.activateVerifyExpired);

    renderWithRouter(routeTree, {
      initialEntries: ['/activate?token=an-expired-token-value'],
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('This link has expired.')).toBeTruthy());
    expect(screen.getByPlaceholderText('Email or phone number')).toBeTruthy();
  });

  it('the resend form always shows the done copy, regardless of the identifier', async () => {
    server.use(
      authHandlers.refreshFailure,
      authHandlers.activateVerifyExpired,
      authHandlers.activateResend,
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/activate?token=an-expired-token-value'],
      locale: 'en',
    });

    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText('Email or phone number');
    await user.type(input, 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));

    await waitFor(() =>
      expect(screen.getByText('If that account needs a new link, one has been sent.')).toBeTruthy(),
    );
  });

  it('shows the suspended state when the account is suspended after verification', async () => {
    server.use(
      authHandlers.refreshFailure,
      authHandlers.activateVerify,
      authHandlers.activateSuspended,
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/activate?token=a-valid-invite-token-value'],
      locale: 'en',
    });

    await setPassword();

    await waitFor(() => expect(screen.getByText('This account has been suspended.')).toBeTruthy());
  });

  it('a successful activation navigates to the dashboard, same as a single-membership login', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.activateVerify, authHandlers.activate);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/activate?token=a-valid-invite-token-value'],
      locale: 'en',
    });

    await setPassword();

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});
