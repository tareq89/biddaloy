import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { ApprovalsPendingView, type PendingCountDto } from './approvals-pending.widget';

const data: PendingCountDto = {
  total: 8,
  by_type: [
    { type: 'STAFF_LEAVE', count: 5 },
    { type: 'FEE_WAIVER', count: 2 },
    { type: 'TESTIMONIAL', count: 1 },
  ],
  oldest_pending_at: '2026-10-03T04:00:00.000Z',
};

const meta: Meta<typeof ApprovalsPendingView> = {
  title: 'Dashboard/Widgets/ApprovalsPending',
  component: ApprovalsPendingView,
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
type Story = StoryObj<typeof ApprovalsPendingView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Zero: Story = {
  args: { data: { total: 0, by_type: [], oldest_pending_at: null } },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
