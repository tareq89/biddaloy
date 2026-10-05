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

/** Weak password + mismatching confirm: rules partly grey, submit disabled. */
export const PartlyMetAndMismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('New password'), 'abcdefgh');
    await userEvent.type(canvas.getByLabelText('Confirm password'), 'different');
  },
};

export const AllMetAndMatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('New password'), 'Strong-pass1');
    await userEvent.type(canvas.getByLabelText('Confirm password'), 'Strong-pass1');
  },
};

export const FamilyAudience: Story = {
  args: { audience: 'family' },
};

export const WithSkip: Story = {
  args: { onSkip: () => {} },
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
