import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { CompletePasswordResetForm } from './complete-password-reset-form';

afterEach(async () => {
  await cleanupTestState();
});

describe('CompletePasswordResetForm', () => {
  it('submits { new_password } only — never the confirm field', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CompletePasswordResetForm onCancel={vi.fn()} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        new_password: 'new-pass',
      }),
    );
  });

  it('blocks submit when the confirm field does not match', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CompletePasswordResetForm onCancel={vi.fn()} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByText('Passwords do not match')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows required-field errors on an empty submit, and does not invent a strength policy', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CompletePasswordResetForm onCancel={vi.fn()} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Save new password' }));

    await waitFor(() => {
      expect(screen.getByText('Enter a new password')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggles both password fields between masked and visible together', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompletePasswordResetForm onCancel={vi.fn()} onSubmit={vi.fn()} />, {
      locale: 'en',
    });

    const current = await screen.findByLabelText('New password');
    expect(current.getAttribute('type')).toBe('password');

    await user.click(screen.getByRole('checkbox', { name: 'Show passwords' }));

    expect(current.getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('Confirm new password').getAttribute('type')).toBe('text');
  });

  it('disables the form while submitting', async () => {
    renderWithProviders(
      <CompletePasswordResetForm onCancel={vi.fn()} onSubmit={vi.fn()} submitting />,
      { locale: 'en' },
    );

    expect((await screen.findByLabelText('New password')).hasAttribute('disabled')).toBe(true);
  });
});
