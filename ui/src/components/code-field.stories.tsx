import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { CodeField } from './code-field';

const meta: Meta<typeof CodeField> = {
  title: 'Components/CodeField',
  component: CodeField,
  tags: ['autodocs'],
  args: { id: 'code', label: 'Authenticator code', onComplete: () => {} },
};

export default meta;
type Story = StoryObj<typeof CodeField>;

export const Totp: Story = {};

export const WithHint: Story = {
  args: { hint: 'Open your authenticator app and type the 6-digit number.' },
};

export const WithError: Story = {
  args: { error: 'That code is not right. Try the next one.' },
};

export const Disabled: Story = { args: { disabled: true } };

export const Recovery: Story = {
  args: { variant: 'recovery', label: 'Recovery code', hint: 'Each code works once.' },
};

export const RecoveryWithError: Story = {
  args: {
    variant: 'recovery',
    label: 'Recovery code',
    error: 'That recovery code was not accepted.',
  },
};

export const Rtl: Story = { decorators: [rtlDecorator] };
