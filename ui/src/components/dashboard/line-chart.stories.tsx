import type { Meta, StoryObj } from '@storybook/react-vite';

import { LineChart, type LineChartPoint } from './line-chart';

const bn = (n: number) => n.toLocaleString('bn-BD');
const months = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
const collected = [310, 340, 365, 290, 330, 355, 320, 345, 380, 215];
const money: LineChartPoint[] = months.map((x, i) => {
  const v = collected[i] ?? 0;
  return { x, y: v * 1000, valueLabel: `৳${bn(v * 1000)}` };
});
const attendance = [88, 91, 90, 87, 92, 89, 86, 90, 91, 93];
const att: LineChartPoint[] = months.map((x, i) => ({
  x,
  y: attendance[i] ?? 0,
  valueLabel: `${bn(attendance[i] ?? 0)}%`,
}));

const meta: Meta<typeof LineChart> = {
  title: 'Dashboard/LineChart',
  component: LineChart,
  tags: ['autodocs'],
  args: {
    label: 'মাসওয়ারি আদায়: সর্বোচ্চ সেপ্টেম্বরে ৳৩,৮০,০০০',
    points: money,
    formatTick: (n) => `${bn(n / 1000)} হা`,
    inProgressFrom: 9,
    futureFrom: 10,
    labelled: [8, 9],
    currentIndex: 9,
  },
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LineChart>;

export const Accountant: Story = {};
export const CommitteeAttendance: Story = {
  args: {
    label: 'মাসওয়ারি হাজিরা: সর্বনিম্ন জুলাইয়ে ৮৬%',
    points: att,
    yDomain: [80, 95],
    formatTick: (n) => `${bn(n)}%`,
    target: { value: 90, label: 'লক্ষ্য ৯০%' },
    labelled: [6],
    inProgressFrom: undefined,
    futureFrom: 10,
    currentIndex: 9,
  },
};
export const TwoPoints: Story = {
  args: {
    label: 'Two months',
    points: money.slice(0, 2),
    inProgressFrom: undefined,
    futureFrom: undefined,
    labelled: [0, 1],
    currentIndex: undefined,
    formatTick: (n) => String(n / 1000),
  },
};
export const AllEqual: Story = {
  args: {
    label: 'Flat',
    points: money.slice(0, 5).map((p) => ({ ...p, y: 300000, valueLabel: '৳৩,০০,০০০' })),
    inProgressFrom: undefined,
    futureFrom: undefined,
    labelled: [4],
    currentIndex: undefined,
  },
};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Bangla: Story = { globals: { locale: 'bn' } };
export const Phone390: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
};
