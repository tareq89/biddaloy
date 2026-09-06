import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ContactChangeDialog } from './contact-change-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('ContactChangeDialog', () => {
  it('phone flow: request then OTP step then confirm', async () => {
    const onRequest = vi.fn().mockResolvedValue('otp');
    const onConfirmOtp = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <ContactChangeDialog
        field="phone"
        open
        onOpenChange={() => {}}
        config={REGION_BD_EN}
        onRequest={onRequest}
        onConfirmOtp={onConfirmOtp}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('New phone number'), '1712345678');
    await user.type(screen.getByLabelText('Current password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalled());
    expect(await screen.findByText('Enter the code')).toBeTruthy();

    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onConfirmOtp).toHaveBeenCalledWith('123456'));
  });

  it('email flow: request then "check your inbox" card', async () => {
    const onRequest = vi.fn().mockResolvedValue('link');
    const user = userEvent.setup();

    renderWithProviders(
      <ContactChangeDialog
        field="email"
        open
        onOpenChange={() => {}}
        config={REGION_BD_EN}
        onRequest={onRequest}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('New email address'), 'new@example.com');
    await user.type(screen.getByLabelText('Current password'), 'hunter2fake');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('new@example.com', 'hunter2fake'));
    expect(await screen.findByText('Check your inbox')).toBeTruthy();
  });

  it('shows an inline error without advancing the step', async () => {
    const onRequest = vi.fn().mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();

    renderWithProviders(
      <ContactChangeDialog
        field="email"
        open
        onOpenChange={() => {}}
        config={REGION_BD_EN}
        onRequest={onRequest}
        error="That password is not correct"
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('New email address'), 'new@example.com');
    await user.type(screen.getByLabelText('Current password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('That password is not correct')).toBeTruthy();
    expect(screen.queryByText('Check your inbox')).toBeNull();
  });
});
