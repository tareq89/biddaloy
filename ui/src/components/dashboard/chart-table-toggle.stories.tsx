import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartTableToggle } from './chart-table-toggle';

const meta: Meta<typeof ChartTableToggle> = {
  title: 'Dashboard/ChartTableToggle',
  component: ChartTableToggle,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof ChartTableToggle>;

const chart = (
  <svg
    role="img"
    aria-label="উপস্থিতির চার্ট"
    viewBox="0 0 200 60"
    className="h-24 w-full text-primary"
  >
    <polyline
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      points="0,40 50,20 100,30 150,10 200,25"
    />
  </svg>
);

const rows = Array.from({ length: 12 }, (_, i) => [`${i + 1} তারিখ`, `${86 + (i % 6)}.${i}%`]);

const args = {
  summary: '৩০ দিনে সর্বনিম্ন ৮৬.৮%, সর্বোচ্চ ৯১.৮%',
  table: {
    caption: 'দিন অনুযায়ী উপস্থিতি',
    columns: ['দিন', 'উপস্থিতির হার'],
    rows,
    numeric: [false, true],
  },
  showTableLabel: 'টেবিল দেখুন',
  showChartLabel: 'চার্ট দেখুন',
  children: chart,
};

export const ChartView: Story = { args };
export const TableView: Story = { args: { ...args, defaultView: 'table' } };
export const WideTablePhone: Story = {
  args: {
    ...args,
    defaultView: 'table',
    table: {
      caption: 'শাখা অনুযায়ী উপস্থিতি',
      columns: ['শাখা', 'উপস্থিত', 'অনুপস্থিত', 'ছুটি', 'মোট', 'হার'],
      rows: rows.map((r, i) => [`শাখা ${i + 1}`, '38', '2', '1', '41', r[1]!]),
      numeric: [false, true, true, true, true, true],
    },
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
