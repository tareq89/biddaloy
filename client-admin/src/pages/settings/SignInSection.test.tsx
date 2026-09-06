import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SignInSection } from './SignInSection';

const SCHOOL_ID = 'school-1';

describe('SignInSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders checked when otpLoginEnabled is true (the default)', async () => {
    renderWithProviders(<SignInSection schoolId={SCHOOL_ID} auth={{ otpLoginEnabled: true }} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const checkbox = await screen.findByLabelText<HTMLInputElement>(
      'Allow sign-in with mobile number + code',
    );
    expect(checkbox.getAttribute('aria-checked') ?? checkbox.checked).toBeTruthy();
  });

  it('renders checked even when auth is undefined (unset resolves to the server default)', async () => {
    renderWithProviders(<SignInSection schoolId={SCHOOL_ID} auth={undefined} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const checkbox = await screen.findByLabelText<HTMLInputElement>(
      'Allow sign-in with mobile number + code',
    );
    expect(checkbox.getAttribute('aria-checked') ?? checkbox.checked).toBeTruthy();
  });

  it('toggles off and saves, showing a success message', async () => {
    const { user } = renderWithProviders(
      <SignInSection schoolId={SCHOOL_ID} auth={{ otpLoginEnabled: true }} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const checkbox = await screen.findByLabelText('Allow sign-in with mobile number + code');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });
});
