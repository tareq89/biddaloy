import type { Meta, StoryObj } from '@storybook/react-vite';

import { ComposeForm } from './-compose-form';
import { SentList } from './-sent-list';

/** Epic 99 #3826. Compose (count loading, ready, none, error) and the sent list. 1440 and 390. */
const meta: Meta<typeof ComposeForm> = {
  title: 'Platform/Announcements',
  component: ComposeForm,
  args: {
    preview: { kind: 'ready', schools: 14, people: 22 },
    onFilterChange: () => {},
    onRetryPreview: () => {},
    onSend: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof ComposeForm>;

const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const phone = { viewport: { defaultViewport: 'mobile1' } };

const ROWS = [
  {
    id: 'an-1',
    title: 'Planned maintenance',
    severity: 'REMINDER',
    statusFilter: ['ACTIVE'],
    sms: false,
    email: true,
    schoolsTargeted: 14,
    schoolsSucceeded: 13,
    recipientCount: 22,
    createdByName: 'Owner One',
    createdAt: '2029-10-12T10:02:00.000Z',
  },
];

export const Compose1440: Story = { parameters: desktop };
export const Compose390: Story = { parameters: phone };
export const Counting: Story = { args: { preview: { kind: 'loading' } } };
export const NoSchool: Story = { args: { preview: { kind: 'ready', schools: 0, people: 0 } } };
export const CountFailed: Story = { args: { preview: { kind: 'error' } } };
export const Waiting: Story = { args: { locked: true } };
export const List1440: Story = {
  parameters: desktop,
  render: () => (
    <SentList
      rows={ROWS}
      loading={false}
      isFetching={false}
      page={1}
      pageSize={25}
      total={ROWS.length}
      onPageChange={() => {}}
    />
  ),
};
export const List390: Story = {
  parameters: phone,
  render: () => (
    <SentList
      rows={ROWS}
      loading={false}
      isFetching={false}
      page={1}
      pageSize={25}
      total={ROWS.length}
      onPageChange={() => {}}
    />
  ),
};
export const ListEmpty: Story = {
  render: () => (
    <SentList
      rows={[]}
      loading={false}
      isFetching={false}
      page={1}
      pageSize={25}
      total={ROWS.length}
      onPageChange={() => {}}
    />
  ),
};
export const ListLoading: Story = {
  render: () => (
    <SentList
      rows={[]}
      loading
      isFetching
      page={1}
      pageSize={25}
      total={0}
      onPageChange={() => {}}
    />
  ),
};
export const ListError: Story = {
  render: () => (
    <SentList
      rows={[]}
      loading={false}
      isFetching={false}
      page={1}
      pageSize={25}
      total={0}
      onPageChange={() => {}}
      error="Could not load the announcements. Try again."
    />
  ),
};
