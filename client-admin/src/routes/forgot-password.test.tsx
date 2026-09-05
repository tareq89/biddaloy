import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

async function submitIdentifier(value: string): Promise<void> {
  const user = userEvent.setup({ delay: null });
  await user.type(await screen.findByLabelText('Email or phone number'), value);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('/forgot-password', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.useRealTimers();
  });

  it('a phone identifier moves to the code step, then the password step, then navigates to the dashboard', async () => {
    server.use(
      authHandlers.refreshFailure,
      authHandlers.forgotPassword,
      authHandlers.resetPassword,
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/forgot-password'],
      locale: 'en',
    });

    await submitIdentifier('01712345678');

    await screen.findByRole('heading', { name: 'Enter the code' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.type(await screen.findByLabelText('New password'), 'a-strong-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });

  it('an email identifier shows the enumeration-safe "link sent" copy, regardless of whether the account exists', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.forgotPassword);

    renderWithRouter(routeTree, { initialEntries: ['/forgot-password'], locale: 'en' });

    await submitIdentifier('unknown@example.com');

    await waitFor(() =>
      expect(
        screen.getByText('If an account exists for that email, a reset link has been sent.'),
      ).toBeTruthy(),
    );
  });

  it('shows a calm rate-limit banner on 429, without leaving the identifier step', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.forgotPasswordRateLimited);

    renderWithRouter(routeTree, { initialEntries: ['/forgot-password'], locale: 'en' });

    await submitIdentifier('01712345678');

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toBe('Too many attempts. Try again in 60 seconds.');
  });

  it('disables resend for 60 seconds after entering the code step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(authHandlers.refreshFailure, authHandlers.forgotPassword);

    renderWithRouter(routeTree, { initialEntries: ['/forgot-password'], locale: 'en' });

    await submitIdentifier('01712345678');
    await screen.findByRole('heading', { name: 'Enter the code' });

    const resendButton = screen.getByRole('button', { name: /Resend in \d+ seconds?/ });
    expect((resendButton as HTMLButtonElement).disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resend code' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });
});
