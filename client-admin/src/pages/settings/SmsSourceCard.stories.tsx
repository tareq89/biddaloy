/** [#4145] Both directions of the SMS source switch. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SmsSourceCard, SmsSwitchBackCard } from './SmsSourceCard';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const meta = {
  title: 'client-admin/settings/SmsSourceCard',
  component: SmsSourceCard,
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof SmsSourceCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Own SMS company: offer to use SchoolManagerP SMS. */
export const SwitchToPlatform: Story = {};

/** SchoolManagerP SMS: offer the way back (confirm dialog on press). */
export const SwitchBackToOwn: Story = { render: () => <SmsSwitchBackCard /> };
