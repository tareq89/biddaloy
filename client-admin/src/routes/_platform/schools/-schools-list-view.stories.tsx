import type { SchoolSummary } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchoolsListView } from './-schools-list-view';

/**
 * #533's three required states: ACTIVE/SUSPENDED rows, empty, loading.
 * `renderName` is a plain `<span>` here (no router) — see
 * `-schools-list-view.tsx`'s own comment on why the real route passes a
 * TanStack `Link` instead.
 */
const meta: Meta<typeof SchoolsListView> = {
  component: SchoolsListView,
  args: {
    search: '',
    onSearchChange: () => {},
    renderName: (school: SchoolSummary) => (
      <span className="font-medium text-primary underline">{school.name}</span>
    ),
  },
};
export default meta;

type Story = StoryObj<typeof SchoolsListView>;

const SCHOOLS: SchoolSummary[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Ananta School',
    slug: 'ananta-school',
    status: 'ACTIVE',
    created_at: '2026-01-15T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Zenith School',
    slug: 'zenith-school',
    status: 'SUSPENDED',
    created_at: '2026-03-20T00:00:00.000Z',
  },
];

export const ActiveAndSuspended: Story = {
  args: {
    schools: SCHOOLS,
    loading: false,
    isFetching: false,
  },
};

export const Empty: Story = {
  args: {
    schools: [],
    loading: false,
    isFetching: false,
  },
};

export const Loading: Story = {
  args: {
    schools: [],
    loading: true,
    isFetching: true,
  },
};
