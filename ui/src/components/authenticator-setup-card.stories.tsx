import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AuthenticatorSetupCard } from './authenticator-setup-card';
import { CodeField } from './code-field';

const meta: Meta<typeof AuthenticatorSetupCard> = {
  title: 'Components/AuthenticatorSetupCard',
  component: AuthenticatorSetupCard,
  tags: ['autodocs'],
  args: {
    otpauthUri: 'otpauth://totp/Example:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example',
    manualKey: 'JBSWY3DPEHPK3PXP',
    labels: {
      title: 'Set up your authenticator app',
      description:
        'Scan this code with your authenticator app, then type the 6-digit number it shows.',
      qrAlt: 'QR code for your authenticator app',
      manualKeyLabel: "Can't scan? Type this key into your app instead:",
      qrError: 'The QR code could not be drawn. Use the key below.',
    },
  },
};

export default meta;
type Story = StoryObj<typeof AuthenticatorSetupCard>;

export const Default: Story = {};

export const WithCodeField: Story = {
  render: (args) => (
    <AuthenticatorSetupCard {...args}>
      <CodeField id="setup-code" label="Authenticator code" />
    </AuthenticatorSetupCard>
  ),
};

export const WithCodeFieldError: Story = {
  render: (args) => (
    <AuthenticatorSetupCard {...args}>
      <CodeField id="setup-code" label="Authenticator code" error="That code is not right." />
    </AuthenticatorSetupCard>
  ),
};

export const Rtl: Story = { decorators: [rtlDecorator] };
