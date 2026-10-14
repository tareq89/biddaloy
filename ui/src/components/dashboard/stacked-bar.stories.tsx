import type { Meta, StoryObj } from '@storybook/react-vite';

import { StackedBar, type StackedBarSegment } from './stacked-bar';

const meta: Meta<typeof StackedBar> = {
  title: 'Dashboard/StackedBar',
  component: StackedBar,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof StackedBar>;

const byMethod: StackedBarSegment[] = [
  { id: 'cash', label: 'Cash', value: 52, valueLabel: '৳ 52,000', detail: '11 payments', color: 'cat-1' },
  { id: 'bkash', label: 'bKash', value: 30, valueLabel: '৳ 30,000', detail: '7 payments', color: 'cat-2' },
  { id: 'bank', label: 'Bank', value: 18, valueLabel: '৳ 18,000', detail: '2 payments', color: 'cat-3' },
];
const ageing: StackedBarSegment[] = [
  { id: 'a', label: '0–30 days', value: 50, valueLabel: '৳ 80,000', detail: '50%', color: 'seq-1' },
  { id: 'b', label: '31–60 days', value: 30, valueLabel: '৳ 48,000', detail: '30%', color: 'seq-2' },
  { id: 'c', label: '60+ days', value: 20, valueLabel: '৳ 32,000', detail: '20%', color: 'seq-3' },
];
const zeroed = (s: StackedBarSegment): StackedBarSegment => ({ ...s, value: 0, valueLabel: '৳ 0' });

export const ByMethod: Story = { args: { label: "Today's collection", segments: byMethod } };
export const Ageing: Story = { args: { label: 'How old are the dues', segments: ageing } };
export const PhoneTile: Story = {
  args: { label: 'Total dues', segments: ageing, size: 'sm', legend: false },
};
export const OneZeroSegment: Story = {
  args: { label: "Today's collection", segments: [byMethod[0]!, byMethod[1]!, zeroed(byMethod[2]!)] },
};
export const AllZero: Story = {
  args: { label: "Today's collection", segments: byMethod.map(zeroed) },
};
export const Dark: Story = {
  args: { label: "Today's collection", segments: byMethod },
  globals: { theme: 'dark' },
};
export const Bangla: Story = {
  args: {
    label: 'আজকের আদায়',
    segments: [
      { id: 'cash', label: 'নগদ', value: 52, valueLabel: '৳ ৫২,০০০', detail: '১১টা পেমেন্ট', color: 'cat-1' },
      { id: 'bkash', label: 'বিকাশ', value: 30, valueLabel: '৳ ৩০,০০০', detail: '৭টা পেমেন্ট', color: 'cat-2' },
      { id: 'bank', label: 'ব্যাংক', value: 18, valueLabel: '৳ ১৮,০০০', detail: '২টা পেমেন্ট', color: 'cat-3' },
    ],
  },
  globals: { locale: 'bn' },
};
