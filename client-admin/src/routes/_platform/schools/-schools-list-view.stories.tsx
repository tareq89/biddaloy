import type { PlatformSchoolSearchItem } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchoolsListView } from './-schools-list-view';

/** Mockup "Schools list" at 1440 px (desktop) and 390 px (phone cards). */
const viewports = {
  desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' } },
  phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' } },
};
const at = (defaultViewport: keyof typeof viewports) => ({
  parameters: { viewport: { viewports, defaultViewport } },
});

const meta: Meta<typeof SchoolsListView> = {
  component: SchoolsListView,
  args: {
    filters: {},
    onFiltersChange: () => {},
    page: 1,
    onPageChange: () => {},
    sorting: null,
    onSortingChange: () => {},
    onNew: () => {},
    onLoginAs: () => {},
    loading: false,
    isFetching: false,
  },
  ...at('desktop1440'),
};
export default meta;

type Story = StoryObj<typeof SchoolsListView>;

const school = (n: number, over: Partial<PlatformSchoolSearchItem>): PlatformSchoolSearchItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `School ${n}`,
  slug: `school-${n}`,
  status: 'ACTIVE',
  statusReason: null,
  createdAt: '2026-01-15T00:00:00.000Z',
  studentCount: 120,
  lastActivityAt: '2026-11-10T00:00:00.000Z',
  trialEndsAt: null,
  seatLimit: null,
  deletedAt: null,
  ...over,
});
const SCHOOLS = [
  school(1, { name: 'Green Valley', studentCount: 412 }),
  school(2, { name: 'Sunrise', trialEndsAt: '2026-12-01T00:00:00.000Z' }),
  school(3, { name: 'Blue River', status: 'SUSPENDED', lastActivityAt: null }),
];

export const Populated: Story = { args: { schools: SCHOOLS, total: 3 } };
export const PopulatedPhone: Story = { args: { schools: SCHOOLS, total: 3 }, ...at('phone390') };
export const Empty: Story = { args: { schools: [], total: 0, filters: { q: 'zzz' } } };
export const EmptyPhone: Story = {
  args: { schools: [], total: 0, filters: { q: 'zzz' } },
  ...at('phone390'),
};
export const Loading: Story = { args: { schools: [], total: 0, loading: true, isFetching: true } };
export const ErrorState: Story = {
  args: { schools: [], total: 0, error: 'Could not load schools.' },
};
