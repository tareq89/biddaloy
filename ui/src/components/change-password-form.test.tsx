import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ChangePasswordForm } from './change-password-form';

afterEach(async () => {
  await cleanupTestState();
});

describe('ChangePasswordForm', () => {
  it('submits { current_password, new_password } only — never the confirm field', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.type(await screen.findByLabelText('Current password'), 'old-pass');
    await user.type(screen.getByLabelText('New password'), 'new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        current_password: 'old-pass',
        new_password: 'new-pass',
      }),
    );
  });

  it('blocks submit when the confirm field does not match', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.type(await screen.findByLabelText('Current password'), 'old-pass');
    await user.type(screen.getByLabelText('New password'), 'new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Passwords do not match')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows required-field errors on an empty submit, and does not invent a strength policy', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.click(await screen.findByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(screen.getByText('Enter your current password')).toBeTruthy();
      expect(screen.getByText('Enter a new password')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the persistent consequence notice unconditionally', async () => {
    renderWithProviders(<ChangePasswordForm onSubmit={vi.fn()} />, { locale: 'en' });

    expect(
      await screen.findByText(
        'Changing your password will sign you out of every other device. This device stays signed in.',
      ),
    ).toBeTruthy();
  });

  it('renders the 403 wrong-current-password server error inline', async () => {
    renderWithProviders(
      <ChangePasswordForm
        onSubmit={vi.fn()}
        serverError={{ fieldErrors: { current_password: 'That password is not correct' } }}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('That password is not correct')).toBeTruthy();
  });

  it('toggles all three password fields between masked and visible together', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordForm onSubmit={vi.fn()} />, { locale: 'en' });

    const current = await screen.findByLabelText('Current password');
    expect(current.getAttribute('type')).toBe('password');

    await user.click(screen.getByRole('checkbox', { name: 'Show passwords' }));

    expect(current.getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('Confirm new password').getAttribute('type')).toBe('text');
  });

  it('disables the form while submitting', async () => {
    renderWithProviders(<ChangePasswordForm onSubmit={vi.fn()} submitting />, { locale: 'en' });

    expect((await screen.findByLabelText('Current password')).hasAttribute('disabled')).toBe(true);
  });
});
