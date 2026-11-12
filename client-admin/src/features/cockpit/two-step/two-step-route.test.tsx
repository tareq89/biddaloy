import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readEnrolHandoff, saveEnrolHandoff } from '../sign-in/enrol-handoff';

import { TwoStepRoute } from './two-step-route';

vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

afterEach(async () => {
  sessionStorage.clear();
  await cleanupTestState();
});

describe('two-step route hand-off', () => {
  it('is read once under StrictMode (wizard shows) and cleared from storage', async () => {
    saveEnrolHandoff({
      enrolToken: 't',
      otpauthUri: 'otpauth://totp/x?secret=ABC',
      secret: 'ABC',
      rememberDevice: false,
    });
    renderWithProviders(
      <React.StrictMode>
        <TwoStepRoute />
      </React.StrictMode>,
      { locale: 'en' },
    );
    expect(await screen.findByLabelText(/6-digit code/)).toBeTruthy();
    expect(readEnrolHandoff()).toBeNull();
  });
});
