import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { DuesAgeingView, type DuesAgeingDto } from './dues-ageing.widget';

const data: DuesAgeingDto = {
  as_of: '2026-10-07',
  total_due: 386000,
  buckets: [
    { bucket: '0_30', amount: 192000, share_pct: 50 },
    { bucket: '31_60', amount: 118000, share_pct: 31 },
    { bucket: '60_PLUS', amount: 76000, share_pct: 20 },
  ],
};

const meta: Meta<typeof DuesAgeingView> = {
  title: 'Dashboard/Widgets/DuesAgeing',
  component: DuesAgeingView,
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
type Story = StoryObj<typeof DuesAgeingView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: {
    data: {
      ...data,
      total_due: 0,
      buckets: data.buckets.map((b) => ({ ...b, amount: 0, share_pct: 0 })),
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
