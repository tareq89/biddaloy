import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { GuardianContactForm } from './guardian-contact-form';

afterEach(async () => {
  await cleanupTestState();
});

const defaultValues = {
  phone: '',
  alternate_phone: '',
  email: '',
  preferred_communication: 'SMS' as const,
  notifications_enabled: true,
};

describe('GuardianContactForm', () => {
  it('[8.14.4] plan correction 2 — normalizes a typed national number into the +880 shape BD_PHONE_REGEX requires', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <GuardianContactForm
        defaultValues={defaultValues}
        config={REGION_BD_EN}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    // Typed *without* a leading 0/+880 — PhoneInput's own validity check
    // still accepts this, and submission must still produce a value the
    // server's BD_PHONE_REGEX (`/^(?:\+?880|0)1[3-9]\d{8}$/`) accepts.
    await user.type(await screen.findByLabelText('Phone'), '1712345678');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '+8801712345678' })),
    );
  });

  it('normalizes a leading-0 national number the same way', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <GuardianContactForm
        defaultValues={defaultValues}
        config={REGION_BD_EN}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Phone'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '+8801712345678' })),
    );
  });

  it('submits an empty phone as "" (clearing), not a normalized value', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <GuardianContactForm
        defaultValues={{ ...defaultValues, phone: '1712345678' }}
        config={REGION_BD_EN}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '' })),
    );
  });

  it('rejects a non-BD-shaped phone number inline', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <GuardianContactForm
        defaultValues={defaultValues}
        config={REGION_BD_EN}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Phone'), '5551234');
    await user.tab();

    expect(await screen.findByText('Enter a valid Bangladeshi mobile number')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a server-side field error inline', async () => {
    renderWithProviders(
      <GuardianContactForm
        defaultValues={defaultValues}
        config={REGION_BD_EN}
        onSubmit={vi.fn()}
        serverError={{ fieldErrors: { phone: 'phone must match the expected pattern' } }}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('phone must match the expected pattern')).toBeTruthy();
  });

  it('toggles notifications_enabled and includes it in the submitted values', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <GuardianContactForm
        defaultValues={defaultValues}
        config={REGION_BD_EN}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    await user.click(
      await screen.findByRole('checkbox', { name: 'Receive fee reminders and notifications' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ notifications_enabled: false }),
      ),
    );
  });
});
