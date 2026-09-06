import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_EN } from '../i18n/region-config';

import { ContactChangeDialog } from './contact-change-dialog';

const meta: Meta<typeof ContactChangeDialog> = {
  title: 'Components/ContactChangeDialog',
  component: ContactChangeDialog,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    config: REGION_BD_EN,
    onRequest: () => new Promise(() => {}),
  },
};

export default meta;
type Story = StoryObj<typeof ContactChangeDialog>;

export const Phone: Story = {
  args: {
    field: 'phone',
  },
};

export const Email: Story = {
  args: {
    field: 'email',
  },
};

/** Field + password filled in, then submitted with a phone `onRequest`
 * that resolves to the OTP step — matches the change-phone flow. */
export const OtpStep: Story = {
  args: {
    field: 'phone',
    onRequest: () => Promise.resolve('otp'),
  },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await userEvent.type(await dialog.findByLabelText('New phone number'), '1712345678');
    await userEvent.type(dialog.getByLabelText('Current password'), 'hunter2fake');
    await userEvent.click(dialog.getByRole('button', { name: 'Continue' }));
    await dialog.findByLabelText('Verification code');
  },
};

/** The 403 "wrong password" case, surfaced inline rather than as a toast —
 * same reasoning as `ChangePasswordForm`'s `WrongCurrentPassword` story. */
export const Error: Story = {
  args: {
    field: 'email',
    error: 'That password is not correct',
  },
};

/** Synthetic RTL rendering ([8.13.x] convention) — no real RTL locale
 * exists yet, mirrors `Button`'s `RightToLeft` story. */
export const RightToLeft: Story = {
  args: {
    field: 'phone',
  },
  decorators: [rtlDecorator],
};
