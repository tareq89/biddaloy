import {
  backupKeys,
  type PreviewResult,
  type RestoreSummary,
  type WorkbookJob,
} from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as React from 'react';

import { RestoreConfirmSlot, RestoreDiffSummary, RestoreProgressPanel } from './restore-wizard';

/**
 * [613, corrected 14.11.5] The restore wizard's per-state stories: the diff
 * preview (with and without errors), the typed-confirmation gate (plain and
 * empty-tenant), and the progress panel's three terminal shapes (in
 * progress, done, failed) — rebuilt against the real server DTOs (see
 * `ui/src/hooks/backup.ts`'s header comment).
 *
 * Same Storybook-not-wired-for-`client-admin` gap
 * `import-preview.stories.tsx` notes — only `ui/src/**` is globbed into
 * this repo's Storybook config today, so this file isn't reachable from a
 * running Storybook instance yet. Written anyway, following that file's
 * precedent, so it's ready once that wiring gap is fixed.
 */

function summary(overrides: Partial<RestoreSummary> = {}): RestoreSummary {
  return {
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Green Valley School',
      source_school_slug: 'green-valley-school',
    },
    totals: { creates: 16, updates: 3, unchanged: 190, deletes: 5 },
    is_empty_tenant: false,
    tabs: [
      { name: 'students', present: true, creates: 12, updates: 3, unchanged: 100, deletes: 5 },
      { name: 'guardians', present: true, creates: 4, updates: 0, unchanged: 90, deletes: 0 },
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
      errors: [{ row: 4, column: 'phone', message: 'Not a valid phone number', severity: 'error' }],
      hard_error_count: 1,
      summary: summary({
        warnings: [
          {
            row: 12,
            column: 'phone',
            message: '3 rows used a legacy phone format and were normalised.',
            severity: 'warning',
          },
        ],
      }),
    }),
  },
};

type ConfirmStory = StoryObj<typeof RestoreConfirmSlot>;

export const Confirm: ConfirmStory = {
  render: (args) => <RestoreConfirmSlot {...args} />,
  args: {
    summary: summary(),
    expectedSchoolName: 'Green Valley School',
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
    summary: summary({ is_empty_tenant: true, tabs: [] }),
    expectedSchoolName: 'Green Valley School',
    confirmationText: '',
    onConfirmationTextChange: () => {},
    inviteRestoredUsers: false,
    onInviteRestoredUsersChange: () => {},
    setBlocked: () => {},
  },
};

function job(overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id: 'job-restore-1',
    kind: 'RESTORE',
    status: 'RUNNING',
    source: 'MANUAL',
    requested_by: { id: 'admin-1', full_name: 'Admin User' },
    size_bytes: null,
    row_counts: null,
    progress: null,
    failed_tab: null,
    snapshot_job_id: 'snapshot-1',
    error: null,
    pinned: false,
    expires_at: null,
    created_at: new Date().toISOString(),
    finished_at: null,
    ...overrides,
  };
}

type ProgressStory = StoryObj<typeof RestoreProgressPanel>;

/** `RestoreProgressPanel` polls `useBackupJob` via react-query, so every
 * story here needs a `QueryClientProvider` — seeded with the same job so
 * the panel renders its terminal/in-progress state immediately instead of
 * a live fetch (this file isn't wired into a running Storybook yet, but
 * kept correct for when it is). */
function withSeededJobQuery(seedJob: WorkbookJob) {
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

const progressJob = job({ progress: { tab: 'students', done: 3, total: 18 } });
export const Progress: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: {
    jobId: progressJob.id,
    snapshotJobId: progressJob.snapshot_job_id ?? '',
    onReset: () => {},
  },
  decorators: [withSeededJobQuery(progressJob)],
};

const doneJob = job({
  id: 'job-restore-done',
  status: 'DONE',
  finished_at: new Date().toISOString(),
  snapshot_job_id: 'snapshot-1',
  row_counts: { students: 115, guardians: 94 },
});
export const Done: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: { jobId: doneJob.id, snapshotJobId: doneJob.snapshot_job_id ?? '', onReset: () => {} },
  decorators: [withSeededJobQuery(doneJob)],
};

const failedJob = job({
  id: 'job-restore-failed',
  status: 'FAILED',
  finished_at: new Date().toISOString(),
  failed_tab: 'guardians',
  error: 'Duplicate natural key at row 14',
  snapshot_job_id: 'snapshot-2',
});
export const Failed: ProgressStory = {
  render: (args) => <RestoreProgressPanel {...args} />,
  args: { jobId: failedJob.id, snapshotJobId: failedJob.snapshot_job_id ?? '', onReset: () => {} },
  decorators: [withSeededJobQuery(failedJob)],
};
