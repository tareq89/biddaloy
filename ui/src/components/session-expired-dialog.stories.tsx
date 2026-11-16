/** [3329 / 4293] Presentational view; the connected `SessionExpiredDialog` decides what a sign-in means. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { SessionExpiredDialogView } from './session-expired-dialog';

const meta: Meta<typeof SessionExpiredDialogView> = {
  title: 'Components/SessionExpiredDialog',
  component: SessionExpiredDialogView,
  tags: ['autodocs'],
  args: { open: true, onSignIn: fn(), onDismiss: fn() },
};

export default meta;
type Story = StoryObj<typeof SessionExpiredDialogView>;

export const Open: Story = {};

export const Signing: Story = { args: { loading: true } };

export const WrongPassword: Story = {
  args: {
    error: { message: 'That email/phone or password is incorrect.', tone: 'alert' },
  },
};
