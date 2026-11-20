import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultCountry } from './country-options';
import { RegisterDetailsForm } from './register-details-form';

function setup(props: Partial<React.ComponentProps<typeof RegisterDetailsForm>> = {}) {
  const onSubmit = vi.fn();
  renderWithProviders(
    <RegisterDetailsForm onSubmit={onSubmit} onCaptchaMissing={vi.fn()} {...props} />,
    { locale: 'en' },
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('RegisterDetailsForm', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('blocks an empty submit and names every required field', async () => {
    const { onSubmit, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getAllByText('This field is required.').length).toBe(3));
    expect(screen.getByText('Enter a valid mobile number.')).toBeTruthy();
    // Email is optional (D6): an empty one is not an error.
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
    expect(screen.getByText('Please accept to continue.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a bad phone and an unticked terms box', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        email: 'a@b.co',
        phone: '123',
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter a valid mobile number.')).toBeTruthy();
    expect(screen.getByText('Please accept to continue.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('opens the documents on the tapped tab without ticking, then Agree ticks and refocuses the box', async () => {
    const { user } = setup();
    const box = await screen.findByRole('checkbox');
    await user.click(screen.getByRole('button', { name: 'Terms' }));
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Terms', selected: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Agree' }));
    await waitFor(() => expect(box.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('opens the Privacy tab from its own link, and closing returns focus to the box', async () => {
    const { user } = setup();
    const box = await screen.findByRole('checkbox');
    await user.click(screen.getByRole('button', { name: 'Privacy policy' }));
    expect(screen.getByRole('tab', { name: 'Privacy policy', selected: true })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('submits a local phone in the sign-in form, with a captcha token, when everything is valid', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        email: 'a@b.co',
        phone: '01712345678',
        terms: true,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ phone: '01712345678', country: 'BD' });
    // The form sign-in sends: a `+880…` here could never be signed in with.
    expect(onSubmit.mock.calls[0]?.[1]).toBe('01712345678');
    expect(onSubmit.mock.calls[0]?.[2]).toBe('no-captcha');
  });

  it('sends a +880 number typed in full in the same local form', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        email: 'a@b.co',
        phone: '+880 1712-345678',
        terms: true,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[1]).toBe('01712345678');
  });

  it('accepts a +country number as typed', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        email: 'a@b.co',
        phone: '+91 98765 43210',
        terms: true,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[1]).toBe('+919876543210');
  });

  it('submits with no email', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        phone: '01712345678',
        terms: true,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('still rejects an email that is typed but malformed', async () => {
    const { onSubmit, user } = setup({
      initialValues: {
        adminName: 'A',
        schoolName: 'S',
        address: 'Addr',
        email: 'nope',
        phone: '01712345678',
        terms: true,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('defaultCountry', () => {
  it('prefers initialCountry, then the time zone, then BD', () => {
    expect(defaultCountry('IN')).toBe('IN');
    expect(defaultCountry('ZZ')).toBe('BD');
    const zone = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    zone.mockReturnValue({ timeZone: 'Asia/Kolkata' } as Intl.ResolvedDateTimeFormatOptions);
    expect(defaultCountry()).toBe('IN');
    zone.mockReturnValue({ timeZone: 'Europe/Oslo' } as Intl.ResolvedDateTimeFormatOptions);
    expect(defaultCountry()).toBe('BD');
    zone.mockRestore();
  });
});
