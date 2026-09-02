import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { ProfileForm } from './profile-form';

const meta: Meta<typeof ProfileForm> = {
  title: 'Components/ProfileForm',
  component: ProfileForm,
  tags: ['autodocs'],
  args: {
    defaultValues: { full_name: 'Karim Rahman', email: 'karim@example.com', phone: '' },
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ProfileForm>;

export const Default: Story = {};

/** [8.14.4] plan correction 5 — the current-password field appears only
 * once `email`/`phone` is edited, never unconditionally. */
export const PasswordRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email'), '.bd');
  },
};

/** A 409 from `PATCH /users/me` — the "email already in use" case (plan
 * correction 4). Never the server's own raw message. */
export const ServerError: Story = {
  args: {
    serverError: { message: 'That email or phone number is already in use' },
  },
};

export const Submitting: Story = {
  args: { submitting: true },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};

export const Bengali: Story = {
  globals: { locale: 'bn' },
};
