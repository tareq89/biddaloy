import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ProfileForm } from './profile-form';

afterEach(async () => {
  await cleanupTestState();
});

const defaultValues = { full_name: 'Karim Rahman', email: 'karim@example.com', phone: '' };

describe('ProfileForm', () => {
  it('submits full_name/email/phone without current_password when neither email nor phone changed', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    const fullName = await screen.findByLabelText('Full name');
    await user.clear(fullName);
    await user.type(fullName, 'Karim Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        full_name: 'Karim Renamed',
        email: 'karim@example.com',
        phone: '',
      }),
    );
  });

  it('[8.14.4] plan correction 5 — only shows the current-password field once email or phone is edited', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={vi.fn()} />, {
      locale: 'en',
    });

    await screen.findByLabelText('Full name');
    expect(screen.queryByLabelText('Current password')).toBeNull();

    await user.type(screen.getByLabelText('Email'), '.bd');
    expect(await screen.findByLabelText('Current password')).toBeTruthy();
  });

  it('blocks submit and asks for the current password when email changed but it is empty', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        screen.getByText('Enter your current password to change your email or phone number'),
      ).toBeTruthy(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('includes current_password once shown and filled', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'new@example.com');
    await user.type(await screen.findByLabelText('Current password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        full_name: 'Karim Rahman',
        email: 'new@example.com',
        phone: '',
        current_password: 'hunter2fake',
      }),
    );
  });

  it('[8.14.4] plan correction 6 — blocks clearing both email and phone at once', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProfileForm
        defaultValues={{ full_name: 'Karim Rahman', email: 'karim@example.com', phone: '' }}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        screen.getByText('You must keep at least an email or a phone number on file'),
      ).toBeTruthy(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("[8.14.4] plan correction 2 — accepts an international, non-BD phone number the server's INTERNATIONAL_PHONE_REGEX allows", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm defaultValues={defaultValues} onSubmit={onSubmit} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Phone'), '+14155550123');
    await user.type(await screen.findByLabelText('Current password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+14155550123', current_password: 'hunter2fake' }),
      ),
    );
  });

  it('renders a 403 server error inline on current_password, not as raw server text', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <ProfileForm defaultValues={defaultValues} onSubmit={vi.fn()} />,
      { locale: 'en' },
    );

    // The current-password field only renders once email/phone is dirty —
    // the real 403 this simulates only ever arrives after such a submit.
    await user.type(await screen.findByLabelText('Email'), '.bd');
    await screen.findByLabelText('Current password');

    rerender(
      <ProfileForm
        defaultValues={defaultValues}
        onSubmit={vi.fn()}
        serverError={{ fieldErrors: { current_password: 'That password is not correct' } }}
      />,
    );

    expect(await screen.findByText('That password is not correct')).toBeTruthy();
  });

  it('renders a top-level 409 conflict message', async () => {
    renderWithProviders(
      <ProfileForm
        defaultValues={defaultValues}
        onSubmit={vi.fn()}
        serverError={{ message: 'That email or phone number is already in use' }}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('That email or phone number is already in use')).toBeTruthy();
  });
});
