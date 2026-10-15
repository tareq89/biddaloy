import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { CollectionMonthView, type CollectionMonthDto } from './collection-month.widget';

const data: CollectionMonthDto = {
  month: '2026-10',
  as_of: '2026-10-07',
  received: 882000,
  billed_for_month: 1210000,
  received_pct: 73,
  last_month_same_point: {
    as_of: '2026-09-07',
    received: 790000,
    billed_for_month: 1215000,
    received_pct: 65,
  },
  last_year_same_point: null,
};

const meta: Meta<typeof CollectionMonthView> = {
  title: 'Dashboard/Widgets/CollectionMonth',
  component: CollectionMonthView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof CollectionMonthView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Behind: Story = { args: { data: { ...data, received_pct: 58 } } };
export const WithLastYear: Story = {
  args: {
    data: {
      ...data,
      last_year_same_point: {
        as_of: '2025-10-07',
        received: 700000,
        billed_for_month: 1100000,
        received_pct: 64,
      },
    },
  },
};
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: { data: { ...data, billed_for_month: 0, received_pct: null } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
