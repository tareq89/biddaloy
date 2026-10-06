import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

async function setPassword(): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('New password'), 'A-strong-pass1!');
  await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
  await user.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('/reset-password', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an honest "invalid link" state when the link has no token', async () => {
    server.use(authHandlers.refreshFailure);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/reset-password'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('This link is incomplete — ask for a new one.')).toBeTruthy(),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask for a new link' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/forgot-password'));
  });

  it('a valid token lets the visitor set a new password and navigates to the dashboard', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.resetPassword);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/reset-password?token=a-valid-reset-token'],
      locale: 'en',
    });

    await setPassword();

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('shows the "link expired" card on a 401', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.resetPasswordInvalid);

    renderWithRouter(routeTree, {
      initialEntries: [`/reset-password?token=${authHandlers.RESET_PASSWORD_INVALID_TOKEN}`],
      locale: 'en',
    });

    await setPassword();

    await waitFor(() =>
      expect(screen.getByText('This link has expired or has already been used.')).toBeTruthy(),
    );
  });

  it('shows the five staff rules (the audience is unknown before the reset)', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, {
      initialEntries: ['/reset-password?token=a-valid-reset-token'],
      locale: 'en',
    });

    await screen.findByLabelText('New password');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});
