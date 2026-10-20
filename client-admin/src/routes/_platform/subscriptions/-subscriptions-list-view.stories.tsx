import type { PlatformSchoolBilling } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SubscriptionsListView } from './-subscriptions-list-view';

/** Epic 49 W4: states are populated, filtered (idle), empty, loading, error and phone width. */
const meta: Meta<typeof SubscriptionsListView> = {
  component: SubscriptionsListView,
  args: {
    search: '',
    onSearchChange: () => {},
    onFilterChange: () => {},
    onOpen: () => {},
    loading: false,
    isFetching: false,
    page: 1,
    pageSize: 20,
    onPageChange: () => {},
    total: 2,
  },
};
export default meta;

type Story = StoryObj<typeof SubscriptionsListView>;

const SCHOOLS: PlatformSchoolBilling[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Ananta School',
    status: 'ACTIVE',
    status_reason: null,
    deleted: false,
    seats_entitled: 300,
    seats_used: 300,
    paid_until: '2027-01-19',
    pending_orders: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Zenith School',
    status: 'SUSPENDED',
    status_reason: 'IDLE',
    deleted: false,
    seats_entitled: 0,
    seats_used: 0,
    paid_until: null,
    pending_orders: 0,
  },
];

export const Populated: Story = { args: { schools: SCHOOLS } };
export const FilteredIdle: Story = { args: { schools: [SCHOOLS[1]!], total: 1, filter: 'idle' } };
export const Empty: Story = { args: { schools: [], total: 0 } };
export const Loading: Story = { args: { schools: [], total: 0, loading: true, isFetching: true } };
export const ErrorState: Story = {
  args: { schools: [], total: 0, error: 'Could not load the subscriptions. Try again.' },
};
export const Phone: Story = {
  ...Populated,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
