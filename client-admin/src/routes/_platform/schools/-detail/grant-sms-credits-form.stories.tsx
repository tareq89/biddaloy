import type { Meta, StoryObj } from '@storybook/react-vite';

import { GrantSmsCreditsForm } from './grant-sms-credits-form';

const meta: Meta<typeof GrantSmsCreditsForm> = {
  component: GrantSmsCreditsForm,
  args: {
    formId: 'grant-sms-credits-form',
    onFieldsChange: () => undefined,
    onSubmit: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof GrantSmsCreditsForm>;

export const Default: Story = {};
