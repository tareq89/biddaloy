import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordStep } from './password-step';

afterEach(cleanupTestState);

describe('PasswordStep', () => {
  it('focuses the first field and submits the email and password on Enter', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<PasswordStep onSubmit={onSubmit} />, { locale: 'en' });
    const id = await screen.findByLabelText('Email or phone number');
    expect(document.activeElement).toBe(id);
    const user = userEvent.setup();
    await user.type(id, 'Owner@Example.test');
    await user.type(screen.getByLabelText('Password'), 'secret-pass{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ email: 'owner@example.test' }, 'secret-pass');
  });

  it('asks for what is missing and does not submit', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<PasswordStep onSubmit={onSubmit} />, { locale: 'en' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter your email or phone number.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the one failure sentence under the password', async () => {
    renderWithProviders(<PasswordStep onSubmit={vi.fn()} error="Sign-in did not work." />, {
      locale: 'en',
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Sign-in did not work.');
  });
});
