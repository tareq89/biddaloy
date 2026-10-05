import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { AuthLayout } from './auth-layout';
import { SetPasswordForm } from './set-password-form';

afterEach(async () => {
  await cleanupTestState();
});

describe('SetPasswordForm framing', () => {
  it('keeps its own card outside AuthLayout, drops it inside', async () => {
    const outside = renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={vi.fn()} />, {
      locale: 'en',
    });
    await screen.findByRole('heading', { level: 1 });
    expect(outside.container.querySelector('form')?.className).toContain('p-8');
    outside.unmount();

    const { container } = renderWithProviders(
      <AuthLayout>
        <SetPasswordForm heading="Welcome" onSubmit={vi.fn()} />
      </AuthLayout>,
      { locale: 'en' },
    );
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('form')?.className).not.toContain('p-8');
  });
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

  it('keeps submit disabled until every rule is met and both fields match', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={onSubmit} />, {
      locale: 'en',
    });
    const submit = screen.getByRole('button', { name: 'Set password' });

    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    expect(submit.disabled).toBe(true);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'Strong-pass1');
    expect(submit.disabled).toBe(true); // confirm still 'short'
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'Strong-pass1');
    expect(screen.getByText('Passwords match')).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });

  it('shows five rules for staff and two for family', async () => {
    const { unmount } = renderWithProviders(
      <SetPasswordForm heading="Welcome" onSubmit={vi.fn()} />,
      { locale: 'en' },
    );
    await screen.findByLabelText('New password');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    unmount();

    renderWithProviders(
      <SetPasswordForm heading="Welcome" onSubmit={vi.fn()} audience="family" />,
      {
        locale: 'en',
      },
    );
    await screen.findByLabelText('New password');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders the skip button only when onSkip is given, and calls it', async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <SetPasswordForm heading="Welcome" onSubmit={vi.fn()} />,
      { locale: 'en' },
    );
    await screen.findByLabelText('New password');
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    unmount();

    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={vi.fn()} onSkip={onSkip} />, {
      locale: 'en',
    });
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('submits the password only, on a matching pair', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SetPasswordForm heading="Welcome" onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('New password'), 'Strong-pass1');
    await user.type(screen.getByLabelText('Confirm password'), 'Strong-pass1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Strong-pass1'));
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
