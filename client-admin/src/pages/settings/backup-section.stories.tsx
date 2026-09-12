import { setActiveRole } from '@biddaloy/ui/api';
import type { BackupJob } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { BackupSection } from './backup-section';

// `BackupSection` self-gates on `Permission.BACKUP_MANAGE` (see its own
// doc comment) — every story needs an active role that holds it, or the
// component renders nothing. No story in this file exercises the
// no-permission case; that's covered by `backup-section.test.tsx` instead.
setActiveRole('ADMIN');

function jobFixture(overrides: Partial<BackupJob> = {}): BackupJob {
  return {
    id: crypto.randomUUID(),
    status: 'DONE',
    type: 'EXPORT',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    requested_by: 'admin@school.example',
    error_message: null,
    file_size_bytes: 1_048_576,
    ...overrides,
  };
}

function jobsHandler(jobs: BackupJob[]) {
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
          HttpResponse.json(jobFixture({ status: 'QUEUED' }), { status: 201 }),
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

export const EveryStatus: Story = {
  parameters: {
    msw: {
      handlers: [
        jobsHandler([
          jobFixture({ id: 'job-queued', status: 'QUEUED', completed_at: null, file_size_bytes: null }),
          jobFixture({ id: 'job-running', status: 'RUNNING', completed_at: null, file_size_bytes: null }),
          jobFixture({ id: 'job-done', status: 'DONE' }),
          jobFixture({
            id: 'job-failed',
            status: 'FAILED',
            completed_at: null,
            file_size_bytes: null,
            error_message: 'Disk quota exceeded',
          }),
          jobFixture({ id: 'job-snapshot', status: 'DONE', type: 'RESTORE' }),
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
