import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { RecentActivityView, type RecentActivityDto } from './recent-activity.widget';

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const data: RecentActivityDto = {
  items: [
    {
      id: 'a1',
      action: 'UPDATE',
      entity_type: 'Student',
      entity_label: null,
      performed_by_name: 'Rahim',
      created_at: ago(5),
      changed_field_count: 2,
    },
    {
      id: 'a2',
      action: 'CREATE',
      entity_type: 'Guardian',
      entity_label: null,
      performed_by_name: null,
      created_at: ago(90),
      changed_field_count: null,
    },
    {
      id: 'a3',
      action: 'PAYMENT_RECEIVED',
      entity_type: 'Payment',
      entity_label: null,
      performed_by_name: 'Karim',
      created_at: ago(300),
      changed_field_count: null,
    },
  ],
};

const meta: Meta<typeof RecentActivityView> = {
  title: 'Dashboard/Widgets/RecentActivity',
  component: RecentActivityView,
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
type Story = StoryObj<typeof RecentActivityView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { items: [] } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
