import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { AdminVerificationModal } from './admin-verification-modal';

const meta: Meta<typeof AdminVerificationModal> = {
  title: 'Components/AdminVerificationModal',
  component: AdminVerificationModal,
  tags: ['autodocs'],
  args: {
    open: true,
    scope: 'fees.duplicate_create',
    onRequestOtp: async () => {},
    onVerify: () => new Promise(() => {}),
    onSuccess: () => {},
    onCancel: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof AdminVerificationModal>;

/** Default: OTP-only, before a code has been requested. */
export const OtpMode: Story = {};

/** Password toggle shown — the school's auth settings allow it
 * (`passwordAllowed`, mocked here since `AuthSettingsDto` doesn't carry
 * the real flag yet — see this component's own doc comment). */
export const PasswordMode: Story = {
  args: { passwordAllowed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Password' }));
  },
};

/** The step-up endpoint rate-limited this admin. */
export const RateLimited: Story = {
  args: {
    error: { code: 'RATE_LIMITED', message: 'Too many attempts.' },
  },
};

/** A submitted OTP code was wrong. */
export const InvalidCode: Story = {
  args: {
    error: { code: 'INVALID_CODE', message: 'That code is wrong.' },
  },
};
