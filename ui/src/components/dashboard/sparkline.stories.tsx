import type { Meta, StoryObj } from '@storybook/react-vite';

import { Sparkline } from './sparkline';

const meta: Meta<typeof Sparkline> = {
  title: 'Dashboard/Sparkline',
  component: Sparkline,
  tags: ['autodocs'],
  args: { values: [86, 87, 89, 88, 90, 91, 92], label: '7-day attendance, 86% to 92%' },
  decorators: [
    (Story) => (
      <div className="w-60">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Sparkline>;

export const Rising: Story = {};
export const Falling: Story = {
  args: { values: [92, 90, 91, 88, 85, 84], label: 'Attendance falling, 92% to 84%' },
};
export const Flat: Story = { args: { values: [5, 5, 5, 5], label: 'No change' } };
export const TwoPoint: Story = { args: { values: [3, 8], label: 'Two readings' } };
export const WithLastDot: Story = { args: { showLastDot: true, color: 'cat-1' } };
export const Dark: Story = { args: { showLastDot: true }, globals: { theme: 'dark' } };
export const Bangla: Story = {
  args: {
    label: '৩০ দিনের উপস্থিতি, ৮৬.৮% থেকে ৯১.৮%',
    showLastDot: true,
  },
  globals: { locale: 'bn' },
};
