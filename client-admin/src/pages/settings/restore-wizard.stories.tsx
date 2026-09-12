import { backupKeys, type BackupJob, type PreviewResult, type RestoreSummary } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as React from 'react';

import { RestoreConfirmSlot, RestoreDiffSummary, RestoreProgressPanel } from './restore-wizard';

/**
 * [613] The restore wizard's per-state stories: the diff preview (with and
 * without errors), the typed-confirmation gate (plain and empty-tenant),
 * and the progress panel's three terminal shapes (in progress, done,
 * failed).
 *
 * Same Storybook-not-wired-for-`client-admin` gap
 * `import-preview.stories.tsx` notes — only `ui/src/**` is globbed into
 * this repo's Storybook config today, so this file isn't reachable from a
 * running Storybook instance yet. Written anyway, following that file's
 * precedent, so it's ready once that wiring gap is fixed.
 */

function summary(overrides: Partial<RestoreSummary> = {}): RestoreSummary {
  return {
    school_name: 'Green Valley School',
    source_school_name: 'Green Valley School',
    exported_at: new Date().toISOString(),
    is_empty_tenant: false,
    tabs: [
      { tab: 'students', create: 12, update: 3, delete: 5, unchanged: 100, errors: 0 },
      { tab: 'guardians', create: 4, update: 0, delete: 0, unchanged: 90, errors: 0 },
    ],
    warnings: [],
    ...overrides,
  };
}

function previewResult(
  overrides: Partial<PreviewResult<RestoreSummary>> = {},
): PreviewResult<RestoreSummary> {
  return {
    staging_id: 'staging-1',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    errors: [],
    hard_error_count: 0,
    summary: summary(),
    ...overrides,
  };
}

const diffMeta: Meta<typeof RestoreDiffSummary> = {
  component: RestoreDiffSummary,
};
export default diffMeta;

type DiffStory = StoryObj<typeof RestoreDiffSummary>;

export const PreviewClean: DiffStory = {
  args: { result: previewResult() },
};

export const PreviewWithErrors: DiffStory = {
  args: {
    result: previewResult({
      errors: [
        { row: 4, column: 'phone', message: 'Not a valid phone number', severity: 'error' },
      ],
      hard_error_count: 1,
      summary: summary({
        tabs: [
          { tab: 'students', create: 12, update: 3, delete: 5, unchanged: 100, errors: 1 },
          { tab: 'guardians', create: 4, update: 0, delete: 0, unchanged: 90, errors: 0 },
        ],
        warnings: ['3 rows used a legacy phone format and were normalised.'],
      }),
    }),
  },
};

type ConfirmStory = StoryObj<typeof RestoreConfirmSlot>;

export const Confirm: ConfirmStory = {
  render: (args) => <RestoreConfirmSlot {...args} />,
  args: {
    result: previewResult(),
    confirmationText: '',
    onConfirmationTextChange: () => {},
    inviteRestoredUsers: false,
    onInviteRestoredUsersChange: () => {},
    setBlocked: () => {},
  },
};

export const EmptyTenant: ConfirmStory = {
  render: (args) => <RestoreConfirmSlot {...args} />,
  args: {
    result: previewResult({ summary: summary({ is_empty_tenant: true, tabs: [] }) }),
    confirmationText: '',
    onConfirmationTextChange: () => {},
    inviteRestoredUsers: false,
    onInviteRestoredUsersChange: () => {},
    setBlocked: () => {},
  },
};

function job(overrides: Partial<BackupJob> = {}): BackupJob {
  return {
    id: 'job-restore-1',
    status: 'RUNNING',
    type: 'RESTORE',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

type ProgressStory = StoryObj<typeof RestoreProgressPanel>;

/** `RestoreProgressPanel` polls `useBackupJob` via react-query, so every
 * story here needs a `QueryClientProvider` — seeded with the same job so
 * the panel renders its terminal/in-progress state immediately instead of
 * a live fetch (this file isn't wired into a running Storybook yet, but
 * kept correct for when it is). */
function withSeededJobQuery(seedJob: BackupJob) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(backupKeys.detail(seedJob.id), seedJob);
  return function Decorator(Story: () => React.ReactNode) {
    return (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const progressJob = job({ current_tab: 'students', tabs_done: 3, tabs_total: 18 });
export const Progress: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: { initialJob: progressJob, onReset: () => {} },
  decorators: [withSeededJobQuery(progressJob)],
};

const doneJob = job({
  status: 'DONE',
  completed_at: new Date().toISOString(),
  snapshot_job_id: 'snapshot-1',
  row_counts: { students: 115, guardians: 94 },
});
export const Done: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: { initialJob: doneJob, onReset: () => {} },
  decorators: [withSeededJobQuery(doneJob)],
};

const failedJob = job({
  status: 'FAILED',
  completed_at: new Date().toISOString(),
  failed_tab: 'guardians',
  error_message: 'Duplicate natural key at row 14',
  snapshot_job_id: 'snapshot-2',
});
export const Failed: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: { initialJob: failedJob, onReset: () => {} },
  decorators: [withSeededJobQuery(failedJob)],
};
