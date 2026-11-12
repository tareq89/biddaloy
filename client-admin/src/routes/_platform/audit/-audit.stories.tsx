import type { Meta, StoryObj } from '@storybook/react-vite';

import { AuditTable } from './-audit-table';
import { LoginAsLog } from './-login-as-log';

/** Epic 99 #3825. States: populated, empty, loading, error. Phone shows cards. */
const meta: Meta<typeof AuditTable> = {
  title: 'Platform/Audit',
  component: AuditTable,
  args: { loading: false, isFetching: false },
};
export default meta;

type Story = StoryObj<typeof AuditTable>;

const ROWS = [
  {
    id: 'a1',
    action: 'FEE_STRUCTURE_CHANGE',
    entityType: 'FeeHead',
    schoolName: 'Rose Valley School',
    tenantId: 't1',
    actorName: 'Rahim',
    impersonatedByName: 'Owner One',
    sessionId: 'v1',
    at: '2029-10-12T10:02:00.000Z',
  },
  {
    id: 'a2',
    action: 'PLATFORM_SCHOOL_RENAMED',
    entityType: 'School',
    schoolName: 'Platform',
    tenantId: null,
    actorName: null,
    impersonatedByName: null,
    sessionId: null,
    at: '2029-10-11T08:00:00.000Z',
  },
];
const VISIT = {
  id: 'v1',
  ownerId: 'o1',
  ownerName: 'Owner One',
  schoolId: 't1',
  schoolName: 'Rose Valley School',
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Bug check',
  entryKind: 'NORMAL',
  startedAt: '2029-10-12T10:00:00.000Z',
  endedAt: '2029-10-12T10:18:00.000Z',
  status: 'ENDED',
  changedCount: 4,
};

const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const phone = { viewport: { defaultViewport: 'mobile1' } };

export const Populated1440: Story = { args: { rows: ROWS }, parameters: desktop };
export const Populated390: Story = { args: { rows: ROWS }, parameters: phone };
export const Empty: Story = { args: { rows: [] } };
export const Loading: Story = { args: { rows: [], loading: true, isFetching: true } };
export const ErrorState: Story = {
  args: { rows: [], error: 'Could not load the audit. Try again.' },
};
export const VisitsDesktop1440: Story = {
  parameters: desktop,
  render: () => (
    <LoginAsLog
      rows={[VISIT, { ...VISIT, id: 'v2', endedAt: null, status: 'ACTIVE' }]}
      loading={false}
      isFetching={false}
      onOpen={() => {}}
    />
  ),
};
export const Visits390: Story = {
  parameters: phone,
  render: () => <LoginAsLog rows={[VISIT]} loading={false} isFetching={false} onOpen={() => {}} />,
};
