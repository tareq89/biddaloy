import { http, HttpResponse } from 'msw';

import type { BackupJob, RestoreSummary } from '../../../hooks/backup';
import type { PreviewResult } from '../../../hooks/use-bulk-upload-preview';
import { paginate } from '../support';

const jobFixture = (overrides: Partial<BackupJob> = {}): BackupJob => ({
  id: 'backup-job-1',
  status: 'DONE',
  type: 'EXPORT',
  created_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  requested_by: 'user-1',
  error_message: null,
  file_size_bytes: 123456,
  ...overrides,
});

const fixtures: BackupJob[] = [jobFixture(), jobFixture({ id: 'backup-job-2', status: 'FAILED' })];

const list = http.get('/api/v1/backup/jobs', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/backup/jobs', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getOne = http.get('/api/v1/backup/jobs/:id', ({ params }) =>
  HttpResponse.json(jobFixture({ id: params.id as string })),
);

const getOneRunning = http.get('/api/v1/backup/jobs/:id', ({ params }) =>
  HttpResponse.json(
    jobFixture({ id: params.id as string, status: 'RUNNING', completed_at: null }),
  ),
);

const download = http.get('/api/v1/backup/jobs/:id/download', () =>
  new HttpResponse(new Blob(['backup-bytes'], { type: 'application/zip' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="backup-export.zip"',
    },
  }),
);

const requestExport = http.post('/api/v1/backup/export', () =>
  HttpResponse.json(jobFixture({ id: 'backup-job-new', status: 'QUEUED' }), { status: 201 }),
);

const restoreSummaryFixture = (overrides: Partial<RestoreSummary> = {}): RestoreSummary => ({
  school_name: 'Green Valley School',
  source_school_name: 'Green Valley School',
  exported_at: new Date().toISOString(),
  is_empty_tenant: false,
  tabs: [
    { tab: 'students', create: 12, update: 3, delete: 1, unchanged: 100, errors: 0 },
    { tab: 'guardians', create: 5, update: 0, delete: 0, unchanged: 90, errors: 0 },
  ],
  warnings: [],
  ...overrides,
});

const validate = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json<PreviewResult<RestoreSummary>>({
    staging_id: 'staging-restore-1',
    // D7's 30-minute stage TTL — kept comfortably in the future so tests
    // don't render the "Expired" copy.
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    errors: [],
    hard_error_count: 0,
    summary: restoreSummaryFixture(),
  }),
);

const validateInvalid = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json<PreviewResult<RestoreSummary>>({
    staging_id: 'staging-restore-invalid',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    errors: [
      {
        row: 1,
        column: null,
        message: 'Archive is corrupted or not a Biddaloy backup file',
        severity: 'error',
      },
    ],
    hard_error_count: 1,
    summary: restoreSummaryFixture({ tabs: [] }),
  }),
);

const restore = http.post('/api/v1/backup/restore', () =>
  HttpResponse.json(jobFixture({ id: 'backup-job-restore', status: 'QUEUED', type: 'RESTORE' }), {
    status: 201,
  }),
);

export const backupHandlers = {
  list,
  listEmpty,
  getOne,
  getOneRunning,
  download,
  requestExport,
  validate,
  validateInvalid,
  restore,
};

export const backupDefaultHandlers = [list, getOne, download, requestExport, validate, restore];
