import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthenticatorSetupCard } from './authenticator-setup-card';
import { CodeField } from './code-field';

const labels = {
  title: 'Set up',
  description: 'Scan it.',
  qrAlt: 'QR code',
  manualKeyLabel: 'Type this key',
  qrError: 'QR failed',
};
const uri = 'otpauth://totp/Ex:a@b.c?secret=JBSWY3DPEHPK3PXP&issuer=Ex';

describe('AuthenticatorSetupCard', () => {
  it('renders the QR as an inline svg and shows the manual key', async () => {
    const { container } = render(
      <AuthenticatorSetupCard otpauthUri={uri} manualKey="JBSWY3DPEHPK3PXP" labels={labels} />,
    );
    expect(await screen.findByRole('img', { name: 'QR code' })).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
  });

  it('keeps the manual key and shows an error when the QR cannot be drawn', async () => {
    // An empty string cannot be encoded by qrcode.
    render(<AuthenticatorSetupCard otpauthUri="" manualKey="JBSWY3DPEHPK3PXP" labels={labels} />);
    expect((await screen.findByRole('alert')).textContent).toBe('QR failed');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
  });

  it('renders children (the confirm field) below the key', async () => {
    render(
      <AuthenticatorSetupCard otpauthUri={uri} manualKey="K" labels={labels}>
        <CodeField id="c" label="Code" />
      </AuthenticatorSetupCard>,
    );
    expect(screen.getByRole('textbox', { name: 'Code' })).toBeTruthy();
    await screen.findByRole('img', { name: 'QR code' });
  });

  it('is axe clean', async () => {
    const { container } = render(
      <AuthenticatorSetupCard otpauthUri={uri} manualKey="K" labels={labels}>
        <CodeField id="c" label="Code" />
      </AuthenticatorSetupCard>,
    );
    await screen.findByRole('img', { name: 'QR code' });
    await expect(container).toHaveNoViolations();
  });
});
