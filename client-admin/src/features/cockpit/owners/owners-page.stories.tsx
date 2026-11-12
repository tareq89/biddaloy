import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ApprovalsTab } from './approvals-tab';
import { HistoryTab } from './history-tab';
import { OwnersTab } from './owners-tab';

/** Epic 98 #3761 owner page panels, phone width. Data comes from the default cockpit mock handlers. */
const ME = '11111111-1111-4111-8111-111111111111';

const meta: Meta = {
  title: 'Cockpit/Platform owners',
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <ApprovalModalHostProvider>
        <Story />
      </ApprovalModalHostProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj;

export const Owners: Story = {
  render: () => <OwnersTab currentUserId={ME} onOpenApprovals={() => undefined} />,
};
export const ApprovalRequests: Story = { render: () => <ApprovalsTab currentUserId={ME} /> };
export const History: Story = { render: () => <HistoryTab /> };
