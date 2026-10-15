import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { CollectionTodayView, type CollectionTodayDto } from './collection-today.widget';

const data: CollectionTodayDto = {
  date: '2026-10-07',
  net: 48500,
  payment_count: 23,
  yesterday_same_time_net: 41200,
  groups: [
    {
      group: 'CASH',
      net: 22000,
      payment_count: 11,
      methods: [{ payment_method: 'CASH', net: 22000, payment_count: 11 }],
    },
    {
      group: 'BKASH',
      net: 6500,
      payment_count: 5,
      methods: [{ payment_method: 'BKASH', net: 6500, payment_count: 5 }],
    },
    {
      group: 'BANK',
      net: 20000,
      payment_count: 7,
      methods: [
        { payment_method: 'CHEQUE', net: 12000, payment_count: 3 },
        { payment_method: 'BANK_TRANSFER', net: 5000, payment_count: 2 },
        { payment_method: 'CARD', net: 3000, payment_count: 2 },
      ],
    },
    { group: 'OTHER_MOBILE', net: 0, payment_count: 0, methods: [] },
  ],
};

const meta: Meta<typeof CollectionTodayView> = {
  title: 'Dashboard/Widgets/CollectionToday',
  component: CollectionTodayView,
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
type Story = StoryObj<typeof CollectionTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: {
    data: {
      ...data,
      net: 0,
      payment_count: 0,
      groups: data.groups.map((g) => ({ ...g, net: 0, payment_count: 0, methods: [] })),
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
