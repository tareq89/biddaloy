import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { SetPasswordForm } from './set-password-form';

afterEach(async () => {
  await cleanupTestState();
});

describe('SetPasswordForm', () => {
  it('renders the heading and two labelled, masked password fields', async () => {
    renderWithProviders(<SetPasswordForm heading="Welcome, Rahima" onSubmit={vi.fn()} />, {
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Welcome, Rahima' })).toBeTruthy();
    const password = screen.getByLabelText('New password');
    const confirm = screen.getByLabelText('Confirm password');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(confirm.getAttribute('type')).toBe('password');
    expect(confirm.getAttribute('autocomplete')).toBe('new-password');
  });

  it('shows a too-short error on submit rather than calling onSubmit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() =>
      expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a mismatch error when the two fields disagree', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'a-strong-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(screen.getByText('Passwords do not match.')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the password only, on a matching pair', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'a-strong-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('a-strong-password'));
  });

  it('toggles each field visibility independently', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={vi.fn()} />, {
      locale: 'en',
    });

    const password = await screen.findByLabelText('New password');
    const confirm = screen.getByLabelText('Confirm password');
    const toggles = screen.getAllByRole('button', { name: 'Show password' });
    expect(toggles).toHaveLength(2);

    await user.click(toggles[0]!);
    expect(password.getAttribute('type')).toBe('text');
    expect(confirm.getAttribute('type')).toBe('password');
  });

  it('renders a server error banner', async () => {
    renderWithProviders(
      <SetPasswordForm
        heading="Welcome"
        onSubmit={vi.fn()}
        error={{ message: 'This link has expired.', tone: 'alert' }}
      />,
      { locale: 'en' },
    );

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toBe('This link has expired.');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <SetPasswordForm heading="Welcome, Rahima" onSubmit={vi.fn()} />,
      { locale: 'en' },
    );
    await screen.findByLabelText('New password');
    await expect(container).toHaveNoViolations();
  });
});
