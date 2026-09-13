import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { AdminVerificationModal } from './admin-verification-modal';

afterEach(async () => {
  await cleanupTestState();
  vi.useRealTimers();
});

describe('AdminVerificationModal', () => {
  it('shows a human scope label and hides the password toggle in OTP-only mode', async () => {
    renderWithProviders(
      <AdminVerificationModal
        open
        scope="fees.duplicate_create"
        onRequestOtp={vi.fn()}
        onVerify={vi.fn()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    await screen.findByText('Approve: create a duplicate fee');
    expect(screen.queryByText('Verification method')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('falls back to a generic label for a scope it doesn\'t know', async () => {
    renderWithProviders(
      <AdminVerificationModal
        open
        scope="reports.export_all"
        onRequestOtp={vi.fn()}
        onVerify={vi.fn()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    await screen.findByText('Approve: reports.export_all');
  });

  it('shows the password method only when passwordAllowed is true, and submits it', async () => {
    const onVerify = vi.fn().mockResolvedValue({
      approval_token: 'tok',
      approver: { id: 'u1', name: 'Admin' },
    });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <AdminVerificationModal
        open
        scope="fees.duplicate_create"
        passwordAllowed
        onRequestOtp={vi.fn()}
        onVerify={onVerify}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('radio', { name: 'Password' }));
    await user.type(
      screen.getByLabelText('Password', { selector: 'input[type="password"]' }),
      'hunter2fake',
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(onVerify).toHaveBeenCalledWith({
        identifier: 'admin@example.com',
        method: 'password',
        password: 'hunter2fake',
      }),
    );
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        approval_token: 'tok',
        approver: { id: 'u1', name: 'Admin' },
      }),
    );
  });

  it('runs the OTP resend timer after sending a code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRequestOtp = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWithProviders(
      <AdminVerificationModal
        open
        scope="fees.duplicate_create"
        onRequestOtp={onRequestOtp}
        onVerify={vi.fn()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    await waitFor(() => expect(onRequestOtp).toHaveBeenCalledWith('admin@example.com'));
    expect(await screen.findByRole('button', { name: /Resend in 60s/ })).toBeTruthy();
  });

  it('renders inline errors, never as a toast', async () => {
    renderWithProviders(
      <AdminVerificationModal
        open
        scope="fees.duplicate_create"
        onRequestOtp={vi.fn()}
        onVerify={vi.fn()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        error={{ code: 'INVALID_CODE', message: 'invalid' }}
      />,
      { locale: 'en' },
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      "That code isn't right. Check it and try again.",
    );
  });

  it('calls onCancel on Escape / Cancel click', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AdminVerificationModal
        open
        scope="fees.duplicate_create"
        onRequestOtp={vi.fn()}
        onVerify={vi.fn()}
        onSuccess={vi.fn()}
        onCancel={onCancel}
      />,
      { locale: 'en' },
    );

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
