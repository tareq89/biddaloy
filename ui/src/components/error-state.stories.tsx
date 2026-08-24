import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { ErrorState } from './error-state';

const meta: Meta<typeof ErrorState> = {
  title: 'Components/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  args: {
    message: 'Could not load students. Check your connection and try again.',
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {};

export const CustomRetryLabel: Story = {
  args: { retryLabel: 'Reload page' },
};

export const RightToLeft: Story = {
  args: {
    message: 'শিক্ষার্থীদের তালিকা লোড করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
    retryLabel: 'আবার চেষ্টা করুন',
  },
  decorators: [rtlDecorator],
};
