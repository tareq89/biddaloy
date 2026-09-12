import { setActiveRole } from '@biddaloy/ui/api';
import type { WorkbookJob } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { BackupSection } from './backup-section';

// `BackupSection` self-gates on `Permission.BACKUP_MANAGE` (see its own
// doc comment) — every story needs an active role that holds it, or the
// component renders nothing. No story in this file exercises the
// no-permission case; that's covered by `backup-section.test.tsx` instead.
setActiveRole('ADMIN');

/** Fixtures rebuilt against the real `WorkbookJobDto` — see
 * `ui/src/hooks/backup.ts`'s header comment. */
function jobFixture(overrides: Partial<WorkbookJob> = {}): WorkbookJob {
  return {
    id: crypto.randomUUID(),
    kind: 'EXPORT',
    status: 'DONE',
    source: 'MANUAL',
    requested_by: { id: 'admin-1', full_name: 'Admin User' },
    size_bytes: '1048576',
    row_counts: null,
    progress: null,
    failed_tab: null,
    snapshot_job_id: null,
    error: null,
    pinned: false,
    expires_at: null,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    ...overrides,
  };
}

function jobsHandler(jobs: WorkbookJob[]) {
  return http.get('/api/v1/backup/jobs', () =>
    HttpResponse.json({ data: jobs, total: jobs.length, page: 1, limit: 10, totalPages: 1 }),
  );
}

const meta: Meta<typeof BackupSection> = {
  component: BackupSection,
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/backup/export', () =>
          HttpResponse.json({ job_id: 'job-new' }, { status: 201 }),
        ),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof BackupSection>;

export const Empty: Story = {
  parameters: {
    msw: { handlers: [jobsHandler([])] },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/backup/jobs', async () => {
          await new Promise(() => {
            /* never resolves — renders the table's loading state */
          });
          return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
        }),
      ],
    },
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/backup/jobs', () => HttpResponse.json(null, { status: 500 }))],
    },
  },
};

export const EveryStatus: Story = {
  parameters: {
    msw: {
      handlers: [
        jobsHandler([
          jobFixture({ id: 'job-queued', status: 'QUEUED', finished_at: null, size_bytes: null }),
          jobFixture({
            id: 'job-running',
            status: 'RUNNING',
            finished_at: null,
            size_bytes: null,
            progress: { tab: 'students', done: 3, total: 17 },
          }),
          jobFixture({ id: 'job-done', status: 'DONE' }),
          jobFixture({
            id: 'job-failed',
            status: 'FAILED',
            finished_at: null,
            size_bytes: null,
            error: 'Disk quota exceeded',
          }),
          jobFixture({ id: 'job-snapshot', status: 'DONE', kind: 'SNAPSHOT' }),
          jobFixture({ id: 'job-restore', status: 'DONE', kind: 'RESTORE' }),
        ]),
      ],
    },
  },
};

export const DeepLinkHighlight: Story = {
  args: { backupJobId: 'job-linked' },
  parameters: {
    msw: {
      handlers: [
        jobsHandler([
          jobFixture({ id: 'job-linked', status: 'DONE' }),
          jobFixture({ id: 'job-other', status: 'DONE' }),
        ]),
        http.get('/api/v1/backup/jobs/:id', ({ params }) =>
          HttpResponse.json(jobFixture({ id: params.id as string, status: 'DONE' })),
        ),
        http.get('/api/v1/backup/jobs/:id/download', () => new HttpResponse(new Blob(['bytes']))),
      ],
    },
  },
};
