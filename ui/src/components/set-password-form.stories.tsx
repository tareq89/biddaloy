import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { SetPasswordForm } from './set-password-form';

const meta: Meta<typeof SetPasswordForm> = {
  title: 'Components/SetPasswordForm',
  component: SetPasswordForm,
  tags: ['autodocs'],
  args: {
    heading: 'Welcome, Rahima',
    subtext: 'Dhanmondi High School',
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SetPasswordForm>;

export const Default: Story = {};

/** Submitting a too-short/mismatched pair triggers Zod's own validation,
 * the same `sign-in-form.stories.tsx`'s `ValidationError` pattern. */
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('New password'), 'short');
    await userEvent.type(canvas.getByLabelText('Confirm password'), 'different');
    await userEvent.click(canvas.getByRole('button', { name: 'Set password' }));
  },
};

export const Submitting: Story = {
  args: { loading: true },
};

export const ServerError: Story = {
  args: {
    error: { message: 'This link has expired. Request a new one below.', tone: 'alert' },
  },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
