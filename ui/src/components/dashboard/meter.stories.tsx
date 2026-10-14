import type { Meta, StoryObj } from '@storybook/react-vite';

import { Meter } from './meter';

const meta: Meta<typeof Meter> = {
  title: 'Dashboard/Meter',
  component: Meter,
  tags: ['autodocs'],
  args: {
    label: 'Collected this month',
    value: 70,
    max: 100,
    valueText: '70%',
    endText: 'Goal ৳12,10,000',
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Meter>;

export const Plain: Story = {};
export const WithMarker: Story = {
  args: { marker: { value: 65, label: 'Last month at this point: 65%' } },
};
export const OverMax: Story = { args: { value: 130, valueText: '130%' } };
export const Zero: Story = { args: { value: 0, valueText: '0%' } };
export const SmallInPhoneTile: Story = {
  args: { size: 'sm', showText: false },
  decorators: [
    (Story) => (
      <div className="w-40">
        <Story />
      </div>
    ),
  ],
};
export const Dark: Story = {
  args: { marker: { value: 65, label: 'Last month at this point: 65%' } },
  globals: { theme: 'dark' },
};
export const Bangla: Story = {
  args: {
    label: 'এ মাসের আদায়',
    valueText: '৭০%',
    endText: 'লক্ষ্য ৳১২,১০,০০০',
    marker: { value: 65, label: 'গত মাসে এ সময়ে ছিল ৬৫%' },
  },
  globals: { locale: 'bn' },
};
