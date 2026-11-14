/** [100.4.02] The buy side of the SMS credit section, one story per mock school ([100.4.01]). */
import type { SmsCreditsResponse } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SmsBundlesPanel } from './SmsBundlesPanel';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const NOW = new Date('2026-11-14T00:00:00Z');

const lot = (id: string, remaining: number, expires_at: string | null) => ({
  id,
  source: 'bundle',
  units_total: 2000,
  remaining,
  expires_at,
});

const credits = (over: Partial<SmsCreditsResponse>): SmsCreditsResponse => ({
  metering: 'PLATFORM',
  available: 0,
  reserved: 0,
  lots: [],
  orders: [],
  source: 'SCHOOLMANAGERP',
  almostFinished: false,
  stopped: false,
  ledger: { data: [], total: 0, page: 1, limit: 25, totalPages: 1 },
  ...over,
});

const meta = {
  title: 'client-admin/settings/SmsBundlesPanel',
  component: SmsBundlesPanel,
  args: { canBuy: true, now: NOW },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof SmsBundlesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OwnProvider: Story = { args: { credits: credits({ source: 'OWN' }) } };
export const SchoolManagerP: Story = {
  args: {
    credits: credits({
      available: 1500,
      lots: [lot('a', 1500, '2027-06-01T00:00:00Z'), lot('b', 300, '2027-01-10T00:00:00Z')],
    }),
  },
};
export const AlmostFinished: Story = {
  args: {
    credits: credits({
      available: 40,
      lots: [lot('a', 40, '2027-06-01T00:00:00Z')],
      almostFinished: true,
    }),
  },
};
export const NothingLeft: Story = { args: { credits: credits({ stopped: true }) } };
export const LotAboutToExpire: Story = {
  args: { credits: credits({ available: 900, lots: [lot('a', 900, '2026-11-20T00:00:00Z')] }) },
};
export const NoExpiryDate: Story = {
  args: { credits: credits({ available: 100, lots: [lot('a', 100, null)] }) },
};
export const PickedSchoolReadOnly: Story = {
  args: { canBuy: false, credits: credits({ available: 900, lots: [lot('a', 900, null)] }) },
};
export const ReturnConfirming: Story = {
  args: {
    returnOrderId: '00000000-0000-4000-8000-0000000002aa',
    credits: credits({
      orders: [
        {
          id: '00000000-0000-4000-8000-0000000002aa',
          name: 'Medium',
          sms_count: 2000,
          price_paisa: 180000,
          status: 'PENDING',
          paid_at: null,
          receipt_available: false,
        },
      ],
    }),
  },
};
export const ReturnPaid: Story = {
  args: {
    returnOrderId: '00000000-0000-4000-8000-0000000002aa',
    credits: credits({
      orders: [
        {
          id: '00000000-0000-4000-8000-0000000002aa',
          name: 'Medium',
          sms_count: 2000,
          price_paisa: 180000,
          status: 'PAID',
          paid_at: '2026-11-14T00:00:00Z',
          receipt_available: true,
        },
      ],
    }),
  },
};
