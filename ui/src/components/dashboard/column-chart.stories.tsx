import type { Meta, StoryObj } from '@storybook/react-vite';

import { ColumnChart, type ColumnChartProps, type ColumnDatum } from './column-chart';

const bn = (n: number) => n.toLocaleString('bn-BD');

const years = [2022, 2023, 2024, 2025, 2026];
const counts = [310, 345, 390, 420, 468];
const enrollment = (fmt: (n: number) => string): ColumnDatum[] =>
  years.map((y, i) => ({
    x: fmt(y).replace(/,/g, ''),
    values: { n: counts[i]! },
    valueLabels: { n: fmt(counts[i]!) },
  }));

const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const fees: ColumnDatum[] = months.map((x, i) => {
  const c = 40 + ((i * 17) % 35);
  const d = 10 + ((i * 7) % 20);
  return { x, values: { c, d }, valueLabels: { c: `${c}k`, d: `${d}k` }, totalLabel: `${c + d}k` };
});

const meta: Meta<typeof ColumnChart> = {
  title: 'Dashboard/ColumnChart',
  component: ColumnChart,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'Admissions rose from 310 in 2022 to 468 in 2026',
    series: [{ id: 'n', label: 'Admissions', color: 'primary' }],
    data: enrollment(String),
    formatTick: String,
    highlightIndex: 4,
    labelled: [0, 4],
    currentIndex: 4,
  },
};
export default meta;
type Story = StoryObj<typeof ColumnChart>;

export const SingleHighlighted: Story = {};

const stackedArgs: Partial<ColumnChartProps> = {
  label: 'Collected versus outstanding fees by month',
  series: [
    { id: 'c', label: 'Collected', color: 'primary' },
    { id: 'd', label: 'Outstanding', color: 'cat-2' },
  ],
  data: fees,
  formatTick: (n) => `${n}k`,
  labelled: [9],
  currentIndex: 9,
};
export const Stacked: Story = { args: stackedArgs };
export const AllZeros: Story = {
  args: {
    data: years.map((y) => ({ x: String(y), values: { n: 0 }, valueLabels: { n: '0' } })),
    labelled: [],
  },
};
export const OneColumn: Story = {
  args: { data: enrollment(String).slice(0, 1), highlightIndex: 0, labelled: [0], currentIndex: 0 },
};
export const Dark: Story = { args: stackedArgs, globals: { theme: 'dark' } };
export const Bangla: Story = {
  args: {
    ...stackedArgs,
    series: [
      { id: 'c', label: 'আদায়', color: 'primary' },
      { id: 'd', label: 'বকেয়া', color: 'cat-2' },
    ],
    data: fees.map((d) => ({
      ...d,
      valueLabels: { c: bn(d.values.c!), d: bn(d.values.d!) },
      totalLabel: bn(d.values.c! + d.values.d!),
    })),
    formatTick: bn,
    label: 'মাসভিত্তিক আদায় বনাম বকেয়া',
  },
  globals: { locale: 'bn' },
};
export const Phone: Story = {
  args: stackedArgs,
  decorators: [
    (Story) => (
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
};
