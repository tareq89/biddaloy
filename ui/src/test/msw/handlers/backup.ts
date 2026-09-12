import { http, HttpResponse } from 'msw';

import type { WorkbookJob } from '../../../hooks/backup';
import { paginate } from '../support';

/** Fixtures rebuilt against the *real* server DTOs — see
 * `server/src/modules/workbook/export/dto/workbook-job.dto.ts` and
 * `server/src/modules/workbook/import/dto/validate-response.dto.ts`. The
 * previous fixtures here encoded an invented shape (`type`/`file_size_bytes`/
 * `completed_at`, a `summary`-wrapped validate response, `warnings` as
 * `string[]`), which is why 3000+ tests passed while the UI crashed against
 * the real API. */
const jobFixture = (overrides: Partial<WorkbookJob> = {}): WorkbookJob => ({
  id: 'backup-job-1',
  kind: 'EXPORT',
  status: 'DONE',
  source: 'MANUAL',
  requested_by: { id: 'user-1', full_name: 'Rahim Uddin' },
  size_bytes: '123456',
  row_counts: { students: 412, guardians: 390 },
  progress: null,
  failed_tab: null,
  snapshot_job_id: null,
  error: null,
  pinned: false,
  expires_at: null,
  created_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  ...overrides,
});

const fixtures: WorkbookJob[] = [
  jobFixture(),
  jobFixture({
    id: 'backup-job-2',
    status: 'FAILED',
    error: 'Could not read the students sheet',
    finished_at: new Date().toISOString(),
  }),
];

// [14.12.3/#617] `storage_total_bytes` — mirrors
// `WorkbookJobListResponseDto.storage_total_bytes`, the sum of DONE jobs'
// `size_bytes`. A fixed fixture value rather than actually summing
// `fixtures`: nothing here exercises the real retention math, only that
// `BackupSection` renders whatever the field says.
const list = http.get('/api/v1/backup/jobs', ({ request }) =>
  HttpResponse.json({ ...paginate(fixtures, request.url), storage_total_bytes: '1200000' }),
);

const listEmpty = http.get('/api/v1/backup/jobs', ({ request }) =>
  HttpResponse.json({ ...paginate([], request.url), storage_total_bytes: '0' }),
);

const pin = http.patch('/api/v1/backup/jobs/:id/pin', async ({ params, request }) => {
  const body = (await request.json()) as { pinned: boolean };
  return HttpResponse.json(jobFixture({ id: params.id as string, pinned: body.pinned }));
});

const getOne = http.get('/api/v1/backup/jobs/:id', ({ params }) =>
  HttpResponse.json(jobFixture({ id: params.id as string })),
);

const getOneRunning = http.get('/api/v1/backup/jobs/:id', ({ params }) =>
  HttpResponse.json(
    jobFixture({
      id: params.id as string,
      status: 'RUNNING',
      finished_at: null,
      progress: { tab: 'students', done: 3, total: 17 },
    }),
  ),
);

const download = http.get(
  '/api/v1/backup/jobs/:id/download',
  () =>
    new HttpResponse(new Blob(['backup-bytes'], { type: 'application/zip' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="backup-export.zip"',
      },
    }),
);

const requestExport = http.post('/api/v1/backup/export', () =>
  HttpResponse.json({ job_id: 'backup-job-new' }, { status: 201 }),
);

/** `ValidateResponseDto` — flat, no `summary` wrapper, `warnings` is
 * `BulkImportErrorDto[]` (has `.message`), not `string[]`. */
const validate = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json({
    staging_id: 'staging-restore-1',
    // D7's 30-minute stage TTL — kept comfortably in the future so tests
    // don't render the "Expired" copy.
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Green Valley School',
      source_school_slug: 'green-valley-school',
    },
    tabs: [
      { name: 'students', present: true, creates: 12, updates: 3, unchanged: 100, deletes: 1 },
      { name: 'guardians', present: true, creates: 5, updates: 0, unchanged: 90, deletes: 0 },
    ],
    totals: { creates: 17, updates: 3, unchanged: 190, deletes: 1 },
    errors: [],
    warnings: [],
    hard_error_count: 0,
    is_empty_tenant: false,
  }),
);

const validateInvalid = http.post('/api/v1/backup/validate', () =>
  HttpResponse.json({
    staging_id: 'staging-restore-invalid',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    meta: {
      schema_version: 1,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      source_school_name: 'Green Valley School',
      source_school_slug: 'green-valley-school',
    },
    tabs: [],
    totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
    errors: [
      {
        row: 1,
        column: null,
        message: 'Archive is corrupted or not a Biddaloy backup file',
        severity: 'error',
      },
    ],
    warnings: [],
    hard_error_count: 1,
    is_empty_tenant: false,
  }),
);

// [14.12.3/#617] `GET /platform/backups/health` — SUPER_ADMIN's per-school
// backup health table. One school with a real last-success timestamp, one
// that has never backed up (the "never" row). Deliberately different
// school names from `./schools.ts`'s `schoolList` fixture (Ananta/Zenith)
// even though the ids happen to be reused — `index.test.tsx` renders both
// tables on the same page, and a shared name would make `getByText`
// ambiguous there.
const platformBackupHealth = http.get('/api/v1/platform/backups/health', () =>
  HttpResponse.json({
    data: [
      {
        school_id: '00000000-0000-4000-8000-000000000001',
        name: 'Backup Health Fixture School A',
        schedule: 'DAILY',
        last_status: 'DONE',
        last_success_at: new Date().toISOString(),
        storage_total_bytes: '1200000',
      },
      {
        school_id: '00000000-0000-4000-8000-000000000002',
        name: 'Backup Health Fixture School B',
        schedule: 'OFF',
        last_status: null,
        last_success_at: null,
        storage_total_bytes: '0',
      },
    ],
  }),
);

const restore = http.post('/api/v1/backup/restore', () =>
  HttpResponse.json(
    { job_id: 'backup-job-restore', snapshot_job_id: 'backup-job-snapshot' },
    { status: 202 },
  ),
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
  pin,
  platformBackupHealth,
};

export const backupDefaultHandlers = [
  list,
  getOne,
  download,
  requestExport,
  validate,
  restore,
  pin,
  platformBackupHealth,
];
