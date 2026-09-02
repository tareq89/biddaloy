import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { ChangePasswordForm } from './change-password-form';

const meta: Meta<typeof ChangePasswordForm> = {
  title: 'Components/ChangePasswordForm',
  component: ChangePasswordForm,
  tags: ['autodocs'],
  args: {
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ChangePasswordForm>;

export const Default: Story = {};

export const PasswordsVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Show passwords' }));
  },
};

/** Submitting empty triggers required-field errors on all three, plus the
 * confirm-mismatch case once both password fields carry different
 * values. */
export const Mismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Current password'), 'old-pass');
    await userEvent.type(canvas.getByLabelText('New password'), 'new-pass');
    await userEvent.type(canvas.getByLabelText('Confirm new password'), 'different-pass');
    await userEvent.click(canvas.getByRole('button', { name: 'Change password' }));
  },
};

export const Submitting: Story = {
  args: { submitting: true },
};

/** [8.14.4] plan correction 4 — the 403 "current password is wrong" case,
 * inline on the field, never the server's raw message. */
export const WrongCurrentPassword: Story = {
  args: {
    serverError: { fieldErrors: { current_password: 'That password is not correct' } },
  },
};

export const Bengali: Story = {
  globals: { locale: 'bn' },
};
