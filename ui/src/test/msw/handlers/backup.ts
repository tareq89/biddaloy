import { http, HttpResponse } from 'msw';

import type { BackupJob, ValidateResponseDto } from '../../../hooks/backup';
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

const validate = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json<ValidateResponseDto>({
    valid: true,
    backup_id: 'backup-job-1',
    created_at: new Date().toISOString(),
    school_name: 'Green Valley School',
    record_counts: { students: 120, guardians: 90 },
    errors: [],
    warnings: [],
  }),
);

const validateInvalid = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json<ValidateResponseDto>({
    valid: false,
    errors: ['Archive is corrupted or not a Biddaloy backup file'],
    warnings: [],
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
