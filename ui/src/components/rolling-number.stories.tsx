import type { Meta, StoryObj } from '@storybook/react-vite';

import { RollingNumber } from './rolling-number';

const meta: Meta<typeof RollingNumber> = {
  title: 'Components/RollingNumber',
  component: RollingNumber,
  tags: ['autodocs'],
  args: { value: '12,345', className: 'text-h1 tabular-nums' },
};

export default meta;
type Story = StoryObj<typeof RollingNumber>;

export const English: Story = {};

export const Bangla: Story = {
  args: { value: '১২,৩৪৫' },
};
