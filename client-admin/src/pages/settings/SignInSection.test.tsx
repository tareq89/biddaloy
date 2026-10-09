import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SignInSection } from './SignInSection';

const SERVER_TEXT = 'SERVER_SECRET_TEXT';
const failing = (path: string, method: 'patch' | 'put' | 'post' = 'patch') =>
  http[method](path, () =>
    HttpResponse.json(
      {
        statusCode: 400,
        message: SERVER_TEXT,
        timestamp: new Date().toISOString(),
        path,
        requestId: 'r',
      },
      { status: 400 },
    ),
  );

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
      'Allow sign-in with a code sent to the phone',
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
      'Allow sign-in with a code sent to the phone',
    );
    expect(checkbox.getAttribute('aria-checked') ?? checkbox.checked).toBeTruthy();
  });

  it('toggles off and saves, showing a success message', async () => {
    const { user } = renderWithProviders(
      <SignInSection schoolId={SCHOOL_ID} auth={{ otpLoginEnabled: true }} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const checkbox = await screen.findByLabelText('Allow sign-in with a code sent to the phone');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('links the help text to the checkbox', async () => {
    renderWithProviders(<SignInSection schoolId={SCHOOL_ID} auth={{ otpLoginEnabled: true }} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const checkbox = await screen.findByLabelText('Allow sign-in with a code sent to the phone');
    const help = document.getElementById(checkbox.getAttribute('aria-describedby')!);
    expect(help?.textContent).toMatch(/sign in without a password/);
  });

  it('shows a translated error, never the server text, when the save fails', async () => {
    server.use(failing('/api/v1/schools/:id/settings'));
    const { user } = renderWithProviders(
      <SignInSection schoolId={SCHOOL_ID} auth={{ otpLoginEnabled: true }} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByLabelText('Allow sign-in with a code sent to the phone'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});
