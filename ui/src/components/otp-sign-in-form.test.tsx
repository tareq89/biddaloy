import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { AuthLayout } from './auth-layout';
import { OtpSignInForm } from './otp-sign-in-form';

afterEach(async () => {
  await cleanupTestState();
  vi.useRealTimers();
});

describe('OtpSignInForm framing', () => {
  it('keeps its own logo and card outside AuthLayout, drops both inside it', async () => {
    const outside = renderWithProviders(<OtpSignInForm onRequest={vi.fn()} onVerify={vi.fn()} />, {
      locale: 'en',
    });
    await screen.findByRole('heading', { level: 1 });
    expect(outside.container.querySelector('form')?.className).toContain('p-8');
    expect(screen.getAllByText('SchoolManager')).toHaveLength(1);
    outside.unmount();

    const { container } = renderWithProviders(
      <AuthLayout>
        <OtpSignInForm onRequest={vi.fn()} onVerify={vi.fn()} />
      </AuthLayout>,
      { locale: 'en' },
    );
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('form')?.className).not.toContain('p-8');
    expect(screen.getAllByText('SchoolManager')).toHaveLength(1);
  });
});

describe('OtpSignInForm', () => {
  it('phone phase: renders a phone field and requires a value before continuing', async () => {
    const onRequest = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />, {
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Send code' }));

    await waitFor(() => expect(screen.getByText('Enter your email or phone number.')).toBeTruthy());
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('canonicalizes a phone to the stored trunk-0 shape and moves to the code phase on success', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('01712345678'));
    await screen.findByRole('heading', { name: 'Enter the code' });
    expect(screen.getByText('We sent a 6-digit code to 01712345678.')).toBeTruthy();
  });

  it('accepts an email: lower-cases it, requests a code for it, and verifies with it', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const onVerify = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={onVerify} />, {
      locale: 'en',
    });

    await user.type(
      await screen.findByLabelText('Mobile number or email'),
      'Rahim@Greenview.edu.bd',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('rahim@greenview.edu.bd'));

    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onVerify).toHaveBeenCalledWith({ identifier: 'rahim@greenview.edu.bd', otp: '123456' });
  });

  it('rejects a value that is neither an email nor a phone number', async () => {
    const onRequest = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Mobile number or email'), 'nope@');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    await screen.findByText('Enter a valid email or an 11-digit phone number.');
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('normalizes Bengali numerals in the code field before verifying', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const onVerify = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={onVerify} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Enter the code' });

    await user.type(screen.getByLabelText('6-digit code'), '১২৩৪৫৬');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onVerify).toHaveBeenCalledWith({ identifier: '01712345678', otp: '123456' });
  });

  it('"Change number" returns to the phone phase', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Enter the code' });

    await user.click(screen.getByRole('button', { name: 'Use a different number' }));

    expect(await screen.findByLabelText('Mobile number or email')).toBeTruthy();
  });

  it('disables resend for 60 seconds after entering the code phase, then re-enables it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />, {
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
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

  it('renders a real verify failure as an assertive alert', async () => {
    renderWithProviders(
      <OtpSignInForm
        onRequest={vi.fn()}
        onVerify={vi.fn()}
        error={{ message: 'That phone number or code is incorrect.', tone: 'alert' }}
      />,
      { locale: 'en' },
    );

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toBe('That phone number or code is incorrect.');
  });

  it('renders a rate-limit error as a calm status banner, not an alert', async () => {
    renderWithProviders(
      <OtpSignInForm
        onRequest={vi.fn()}
        onVerify={vi.fn()}
        error={{ message: 'Too many attempts. Try again in 60 seconds.', tone: 'status' }}
      />,
      { locale: 'en' },
    );

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toBe('Too many attempts. Try again in 60 seconds.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no accessibility violations in either phase', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <OtpSignInForm onRequest={onRequest} onVerify={vi.fn()} />,
      { locale: 'en' },
    );
    await screen.findByLabelText('Mobile number or email');
    await expect(container).toHaveNoViolations();

    await user.type(screen.getByLabelText('Mobile number or email'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Enter the code' });
    await expect(container).toHaveNoViolations();
  });
});
