import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { EmptyState } from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: {
    title: 'No fee structures yet',
    explanation: 'Create one to start generating monthly fees.',
    action: { label: 'Create fee structure', onClick: () => {} },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

export const RightToLeft: Story = {
  args: {
    title: 'এখনও কোনো ফি কাঠামো নেই',
    explanation: 'মাসিক ফি তৈরি শুরু করতে একটি তৈরি করুন।',
    action: { label: 'ফি কাঠামো তৈরি করুন', onClick: () => {} },
  },
  decorators: [rtlDecorator],
};
