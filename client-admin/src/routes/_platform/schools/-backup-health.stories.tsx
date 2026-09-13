import type { Meta, StoryObj } from '@storybook/react-vite';

import { BackupHealthTable, type BackupHealthTableProps } from './-backup-health';

const meta: Meta<typeof BackupHealthTable> = {
  component: BackupHealthTable,
};
export default meta;

type Story = StoryObj<typeof BackupHealthTable>;

const BASE_ROWS: BackupHealthTableProps['rows'] = [
  {
    school_id: 'school-1',
    name: 'Ananta School',
    schedule: 'DAILY',
    last_status: 'DONE',
    last_success_at: new Date('2026-09-11T02:00:00Z').toISOString(),
    storage_total_bytes: String(120 * 1024 * 1024),
  },
  {
    school_id: 'school-2',
    name: 'Zenith School',
    schedule: 'WEEKLY',
    last_status: 'FAILED',
    // Most recent attempt failed, but an older backup still exists —
    // `last_status`/`last_success_at` deliberately disagree here.
    last_success_at: new Date('2026-08-30T02:00:00Z').toISOString(),
    storage_total_bytes: String(80 * 1024 * 1024),
  },
  {
    school_id: 'school-3',
    name: 'Never Backed Up School',
    schedule: 'OFF',
    last_status: null,
    last_success_at: null,
    storage_total_bytes: '0',
  },
];

export const Populated: Story = {
  args: { rows: BASE_ROWS, loading: false, isFetching: false },
};

export const Empty: Story = {
  args: { rows: [], loading: false, isFetching: false },
};

export const Loading: Story = {
  args: { rows: [], loading: true, isFetching: true },
};

export const ErrorState: Story = {
  args: { rows: [], loading: false, isFetching: false, error: 'Could not load backup health.' },
};
