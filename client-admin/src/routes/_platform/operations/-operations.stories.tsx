import type { Meta, StoryObj } from '@storybook/react-vite';

import { QueuesTable } from './-queues-table';
import { RestoreLockCard } from './-restore-lock-card';
import { SystemCard } from './-system-card';

/** Epic 99 #3823. States: populated, empty, loading, error, Redis down, restoring. Phone shows cards. */
const meta: Meta<typeof QueuesTable> = {
  title: 'Platform/Operations',
  component: QueuesTable,
  args: { loading: false, isFetching: false, onRetry: () => {} },
};
export default meta;

type Story = StoryObj<typeof QueuesTable>;

const QUEUES = [
  { name: 'sms', available: true, waiting: 4, failed: 3 },
  { name: 'export', available: true, waiting: 0, failed: 0 },
  { name: 'backup', available: false },
];
const SYSTEM = {
  appVersion: '1.42.0',
  lastMigration: '1790000000000-AddThing',
  database: 'ok' as const,
  redis: 'ok' as const,
  restoring: [],
};

export const Populated: Story = { args: { queues: QUEUES } };
export const Empty: Story = { args: { queues: [] } };
export const Loading: Story = { args: { queues: [], loading: true, isFetching: true } };
export const ErrorState: Story = {
  args: { queues: [], error: 'Could not load operations. Try again.' },
};
export const Phone: Story = {
  args: { queues: QUEUES },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const SystemHealthy: Story = { render: () => <SystemCard system={SYSTEM} /> };
export const SystemRedisDown: Story = {
  render: () => <SystemCard system={{ ...SYSTEM, redis: 'fail' }} />,
};
export const Restoring: Story = {
  render: () => (
    <RestoreLockCard
      onRelease={() => {}}
      restoring={[
        { schoolId: 's-1', schoolName: 'Ananta School', jobStatus: 'RUNNING', locked: true },
        { schoolId: 's-2', schoolName: 'Zenith School', jobStatus: 'QUEUED', locked: false },
      ]}
    />
  ),
};
export const NoRestore: Story = {
  render: () => <RestoreLockCard onRelease={() => {}} restoring={[]} />,
};
