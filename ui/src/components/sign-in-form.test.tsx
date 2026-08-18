import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { SignInForm } from './sign-in-form';

afterEach(async () => {
  await cleanupTestState();
});

describe('SignInForm', () => {
  it('renders one identifier field and a password field, correctly labelled for password managers', async () => {
    renderWithProviders(<SignInForm onSubmit={vi.fn()} />, { locale: 'en' });

    const identifier = await screen.findByRole('textbox', { name: 'Email or phone number' });
    expect(identifier.getAttribute('autocomplete')).toBe('username');

    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
  });

  it('detects an email identifier and submits it as { email, password }', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.type(
      await screen.findByRole('textbox', { name: 'Email or phone number' }),
      'rahim@greenview.edu.bd',
    );
    await user.type(screen.getByLabelText('Password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'rahim@greenview.edu.bd',
        password: 'hunter2fake',
      }),
    );
  });

  it('detects a phone identifier and canonicalizes it to the stored trunk-0 shape', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.type(
      await screen.findByRole('textbox', { name: 'Email or phone number' }),
      '+8801712345678',
    );
    await user.type(screen.getByLabelText('Password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ phone: '01712345678', password: 'hunter2fake' }),
    );
  });

  it('shows plain, specific required-field errors on an empty submit rather than submitting', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={onSubmit} />, { locale: 'en' });

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Enter your email or phone number.')).toBeTruthy();
      expect(screen.getByText('Password is required.')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a value that is neither a valid email nor a valid phone number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={vi.fn()} />, { locale: 'en' });

    const identifier = await screen.findByRole('textbox', { name: 'Email or phone number' });
    await user.type(identifier, 'not-a-real-identifier');
    await user.tab();

    await waitFor(() =>
      expect(screen.getByText('Enter a valid email or an 11-digit phone number.')).toBeTruthy(),
    );
  });

  it('toggles the password field between masked and visible, with a matching accessible name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={vi.fn()} />, { locale: 'en' });

    const password = await screen.findByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);

    expect(password.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('renders a rate-limit error as a calm status banner, not an alert', async () => {
    renderWithProviders(
      <SignInForm
        onSubmit={vi.fn()}
        error={{ message: 'Too many attempts. Try again in 45 seconds.', tone: 'status' }}
      />,
      { locale: 'en' },
    );

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toBe('Too many attempts. Try again in 45 seconds.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a real login failure as an assertive alert', async () => {
    renderWithProviders(
      <SignInForm
        onSubmit={vi.fn()}
        error={{ message: 'That email/phone or password is incorrect.', tone: 'alert' }}
      />,
      { locale: 'en' },
    );

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toBe('That email/phone or password is incorrect.');
  });

  it('disables the form and announces the busy state while submitting', async () => {
    renderWithProviders(<SignInForm onSubmit={vi.fn()} loading />, { locale: 'en' });

    // Accessible name is "Signing in Loading" — Button's own sr-only
    // "Loading" text (see button.tsx) is concatenated onto the visible
    // label, not a separate node.
    const submit = await screen.findByRole('button', { name: /Signing in/ });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByLabelText('Email or phone number')).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<SignInForm onSubmit={vi.fn()} />, { locale: 'en' });
    await screen.findByRole('textbox', { name: 'Email or phone number' });
    await expect(container).toHaveNoViolations();
  });

  it('is completable by keyboard alone', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSubmit={onSubmit} />, { locale: 'en' });
    await screen.findByRole('textbox', { name: 'Email or phone number' });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /email or phone/i }));
    await user.keyboard('rahim@greenview.edu.bd');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    await user.keyboard('hunter2fake');

    await user.tab(); // show/hide toggle
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show password' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }));
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'rahim@greenview.edu.bd',
        password: 'hunter2fake',
      }),
    );
  });
});
