import {
  cleanupTestState,
  renderWithProviders,
  server,
  userHandlers,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordDialog } from './reset-password-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('ResetPasswordDialog', () => {
  it('confirming calls the admin-reset mutation and closes the dialog', async () => {
    server.use(userHandlers.adminResetPassword);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const staffUser = userResponseFactory({
      id: 'user-1',
      full_name: 'Karim',
      phone: '01712345678',
    });

    const { localeReady } = renderWithProviders(
      <ResetPasswordDialog open onOpenChange={onOpenChange} user={staffUser} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    expect(await screen.findByText('A code will be sent by SMS to their phone.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the email channel when the user has no phone', async () => {
    server.use(userHandlers.adminResetPassword);
    const staffUser = userResponseFactory({
      id: 'user-2',
      full_name: 'Rahima',
      phone: null,
      email: 'rahima@example.com',
    });

    const { localeReady } = renderWithProviders(
      <ResetPasswordDialog open onOpenChange={vi.fn()} user={staffUser} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    expect(await screen.findByText('A reset link will be sent to their email.')).toBeTruthy();
  });

  it('shows the no-contact copy on a 400 and keeps Confirm disabled', async () => {
    server.use(userHandlers.adminResetPasswordNoContact);
    const user = userEvent.setup();
    const staffUser = userResponseFactory({ id: 'user-3', full_name: 'Nasrin' });

    const { localeReady } = renderWithProviders(
      <ResetPasswordDialog open onOpenChange={vi.fn()} user={staffUser} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Reset password' }));

    await waitFor(() =>
      expect(
        screen.getByText("This user has no phone or email on file — a reset can't be sent."),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Reset password' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
