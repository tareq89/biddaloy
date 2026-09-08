import type { Meta, StoryObj } from '@storybook/react-vite';

import { GrantSmsCreditsForm } from './grant-sms-credits-form';

const meta: Meta<typeof GrantSmsCreditsForm> = {
  component: GrantSmsCreditsForm,
  args: {
    submitting: false,
    onFieldsChange: () => undefined,
    onSubmit: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof GrantSmsCreditsForm>;

export const Default: Story = {};

export const Submitting: Story = {
  args: { submitting: true },
};

export const ErrorState: Story = {
  args: { submitError: 'units must be a non-zero integer' },
};
