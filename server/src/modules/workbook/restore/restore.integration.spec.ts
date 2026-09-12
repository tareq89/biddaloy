import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { User } from '../../users/entities/user.entity';
import { ImportStagingService } from '../../bulk-import/import-staging.service';
import { ValidationService } from '../import/validation.service';
import { RestoreProcessor } from './restore.processor';
import { writeWorkbook } from '../codec/workbook-codec';
import { SCHEMA_VERSION } from '../codec/meta';
import { schoolTab } from '../tabs/school/school.tab';
import { academicYearsTab } from '../tabs/academics/academic-years.tab';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

/** In-memory stand-in for `StorageService` — mirrors the pattern
 * `export.integration.spec.ts` already uses for the same reason: no
 * S3/MinIO needed to exercise the real read/write round trip. */
class FakeStorageService {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<{ body: Readable }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`FakeStorageService: no object at "${key}"`);
    return { body: Readable.from([body]) };
  }
}

/** Minimal in-memory Redis stand-in for `ImportStagingService` — just the
 * three commands it calls (`set`/`get`/`getdel`), enough to exercise the
 * real single-use `consume` semantics (#693 seam) without a real Redis. */
class FakeRedis {
  private readonly store = new Map<string, string>();

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return value;
  }
}

function noopCtx() {
  return { keyOf: () => '' };
}

/** Builds a real `.xlsx` buffer containing only the `school` and
 * `academic_years` sheets — the other 16 `ALL_TABS` sheets are simply
 * absent, which `ValidationService` (and the processor) treat as "leave
 * this tab's rows unchanged," not an error. This keeps the fixture small
 * while still exercising the real read -> validate -> apply pipeline. */
async function buildWorkbook(input: {
  school: { id: string; name: string };
  years: Array<{ id: string; name: string; start: string; end: string; is_current: boolean }>;
}): Promise<Buffer> {
  return writeWorkbook({
    tabs: [schoolTab, academicYearsTab],
    meta: {
      schema_version: SCHEMA_VERSION,
      kind: 'BACKUP',
      exported_at: new Date().toISOString(),
      app_version: 'test',
      source_school_name: input.school.name,
      source_school_slug: 'test-school',
    },
    rowsFor: async function* (tab) {
      if (tab.name === 'school') {
        yield {
          id: input.school.id,
          name: input.school.name,
          name_bn: null,
          address: null,
          phone: null,
          email: null,
          registration_id: null,
          settings: null,
        };
      } else if (tab.name === 'academic_years') {
        for (const year of input.years) {
          yield {
            id: year.id,
            name: year.name,
            start_date: year.start,
            end_date: year.end,
            is_current: year.is_current,
          };
        }
      }
    },
  });
}

function fakeJob(jobId: string, inviteUsers = false) {
  return { data: { jobId, inviteUsers } } as any;
}

describe('RestoreProcessor (integration)', () => {
  let dataSource: DataSource;
  let auditService: AuditService;
  let storage: FakeStorageService;
  let staging: ImportStagingService;
  let validationService: ValidationService;
  let processor: RestoreProcessor;
  let restoreServiceStub: { release: ReturnType<typeof vi.fn> };
  let events: { emitFinished: ReturnType<typeof vi.fn> };
  let invitations: { issueAndSend: ReturnType<typeof vi.fn> };

  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const USER_ID = randomUUID();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    auditService = new AuditService(dataSource.getRepository(AuditLog));
    storage = new FakeStorageService();
    staging = new ImportStagingService(new FakeRedis() as any);
    validationService = new ValidationService();
    restoreServiceStub = { release: vi.fn().mockResolvedValue(undefined) };
    events = { emitFinished: vi.fn() };
    invitations = { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) };

    processor = new RestoreProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      staging,
      validationService,
      invitations as any,
      auditService,
      events as any,
      restoreServiceStub as any,
    );

    await dataSource.getRepository(School).save([
      dataSource.getRepository(School).create({
        id: TENANT_A,
        name: 'Restore Test School A',
        slug: `restore-test-a-${TENANT_A.slice(0, 8)}`,
      }),
      dataSource.getRepository(School).create({
        id: TENANT_B,
        name: 'Restore Test School B',
        slug: `restore-test-b-${TENANT_B.slice(0, 8)}`,
      }),
    ]);

    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: USER_ID,
        email: `restore-608-${USER_ID.slice(0, 8)}@test.com`,
        full_name: 'Restore Test Admin',
      }),
    );
  });

  afterAll(async () => {
    // `audit_logs` is append-only (a DB trigger blocks UPDATE/DELETE on it —
    // see `block_audit_logs_write_only()`), and this suite's restores each
    // write one, so the rows that reference it (School, the WorkbookJob rows
    // themselves) can never be deleted here either. That is fine: the global
    // test setup drops and recreates the whole database before every run
    // (`test/global-setup.ts`), so leaving these rows behind does not leak
    // across test files or runs.
    await dataSource.getRepository(AcademicYear).delete({ tenant_id: TENANT_A });
    await dataSource.getRepository(AcademicYear).delete({ tenant_id: TENANT_B });
  });

  /** Stages a real workbook buffer under `ImportStagingService`, uploads it
   * to the fake storage, and creates a QUEUED restore job row plus an
   * already-DONE snapshot job row — i.e. everything `RestoreService.request`
   * (#607) would have set up before enqueueing. */
  async function setupRestoreJob(tenantId: string, buffer: Buffer): Promise<WorkbookJob> {
    const key = `staging/${randomUUID()}.xlsx`;
    await storage.put(key, buffer);
    const { stagingId } = await staging.stage(tenantId, USER_ID, {
      workbook_storage_key: key,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: false,
      errors: [],
      warnings: [],
    });

    const snapshot = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: tenantId,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.DONE,
        requested_by_user_id: USER_ID,
      }),
    );

    return dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: tenantId,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: USER_ID,
        staging_id: stagingId,
        snapshot_job_id: snapshot.id,
      }),
    );
  }

  it('applies a fixture workbook onto a diverged tenant: creates the missing year and removes the one absent from the workbook', async () => {
    const keptYearId = randomUUID();
    const droppedYearId = randomUUID(); // exists in the DB, absent from the workbook
    const newYearId = randomUUID(); // absent from the DB, present in the workbook

    await dataSource.getRepository(AcademicYear).save([
      dataSource.getRepository(AcademicYear).create({
        id: keptYearId,
        tenant_id: TENANT_A,
        name: 'Kept Year',
        start_date: new Date(2024, 0, 1),
        end_date: new Date(2024, 11, 31),
        is_current: false,
      }),
      dataSource.getRepository(AcademicYear).create({
        id: droppedYearId,
        tenant_id: TENANT_A,
        name: 'Dropped Year',
        start_date: new Date(2023, 0, 1),
        end_date: new Date(2023, 11, 31),
        is_current: false,
      }),
    ]);

    const buffer = await buildWorkbook({
      // The name is deliberately different from the DB's own — proves it is
      // ignored (see school.tab.ts's upsert), not merely unchanged because
      // the fixture happened to match.
      school: { id: TENANT_A, name: 'Restore Test School A (should not apply)' },
      years: [
        {
          id: keptYearId,
          name: 'Kept Year',
          start: '2024-01-01',
          end: '2024-12-31',
          is_current: false,
        },
        {
          id: newYearId,
          name: 'New Year',
          start: '2026-01-01',
          end: '2026-12-31',
          is_current: true,
        },
      ],
    });

    const job = await setupRestoreJob(TENANT_A, buffer);

    await processor.process(fakeJob(job.id));

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: job.id } });
    expect(finished.status).toBe(WorkbookJobStatus.DONE);
    expect(finished.error).toBeNull();
    expect(finished.failed_tab).toBeNull();
    // 2 rows applied in the workbook's academic_years sheet (kept + new).
    expect(finished.row_counts?.academic_years).toBe(2);
    expect(restoreServiceStub.release).toHaveBeenCalledWith(TENANT_A, job.id);

    const years = await dataSource.getRepository(AcademicYear).find({
      where: { tenant_id: TENANT_A },
    });
    const names = years.map((y) => y.name).sort();
    // Kept Year survives (matched by natural key), New Year is created,
    // Dropped Year is gone (delete-by-absence).
    expect(names).toEqual(['Kept Year', 'New Year']);

    const school = await dataSource
      .getRepository(School)
      .findOneOrFail({ where: { id: TENANT_A } });
    // `name` is exported but never applied by a restore — it's the
    // destination's own identity (school.tab.ts's upsert).
    expect(school.name).toBe('Restore Test School A');
  });

  it('never lets a workbook whose ids belong to tenant B change anything in tenant B', async () => {
    const otherTenantYearId = randomUUID();
    await dataSource.getRepository(AcademicYear).save(
      dataSource.getRepository(AcademicYear).create({
        id: otherTenantYearId,
        tenant_id: TENANT_B,
        name: 'Tenant B Untouched Year',
        start_date: new Date(2024, 0, 1),
        end_date: new Date(2024, 11, 31),
        is_current: false,
      }),
    );

    // A hostile workbook whose row id happens to equal a real tenant-B row's
    // id, staged and restored for tenant A. tenantId comes only from the
    // job row, so this must land as a tenant-A row (or fail), never touch B.
    const buffer = await buildWorkbook({
      school: { id: TENANT_A, name: 'Restore Test School A' },
      years: [
        {
          id: otherTenantYearId,
          name: 'Hostile Year',
          start: '2025-01-01',
          end: '2025-12-31',
          is_current: false,
        },
      ],
    });

    const job = await setupRestoreJob(TENANT_A, buffer);
    await processor.process(fakeJob(job.id));

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: job.id } });
    expect(finished.status).toBe(WorkbookJobStatus.DONE);

    const tenantBYear = await dataSource
      .getRepository(AcademicYear)
      .findOneOrFail({ where: { id: otherTenantYearId } });
    expect(tenantBYear.tenant_id).toBe(TENANT_B);
    expect(tenantBYear.name).toBe('Tenant B Untouched Year');

    const tenantARows = await dataSource
      .getRepository(AcademicYear)
      .find({ where: { tenant_id: TENANT_A } });
    expect(tenantARows.some((y) => y.name === 'Hostile Year')).toBe(true);
  });

  it('fails the job when a tab upsert throws, leaves the job FAILED with failed_tab set, and releases the lock', async () => {
    const buffer = await buildWorkbook({
      school: { id: TENANT_A, name: 'Restore Test School A' },
      years: [
        {
          id: randomUUID(),
          name: 'Boom Year',
          start: '2027-01-01',
          end: '2027-12-31',
          is_current: false,
        },
      ],
    });

    const job = await setupRestoreJob(TENANT_A, buffer);

    const upsertSpy = vi
      .spyOn(academicYearsTab, 'upsert')
      .mockRejectedValueOnce(new Error('simulated failure'));

    await processor.process(fakeJob(job.id));

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: job.id } });
    expect(finished.status).toBe(WorkbookJobStatus.FAILED);
    expect(finished.failed_tab).toBe('academic_years');
    expect(finished.error).toBe('simulated failure');
    expect(restoreServiceStub.release).toHaveBeenCalledWith(TENANT_A, job.id);

    // `school` (an earlier tab in ALL_TABS order) was applied and committed
    // before `academic_years` failed.
    const school = await dataSource
      .getRepository(School)
      .findOneOrFail({ where: { id: TENANT_A } });
    expect(school.name).toBe('Restore Test School A');

    upsertSpy.mockRestore();
  });

  it('fails the restore with SNAPSHOT_FAILED and touches nothing when the snapshot job is FAILED', async () => {
    const buffer = await buildWorkbook({
      school: { id: TENANT_A, name: 'Should not apply' },
      years: [],
    });
    const key = `staging/${randomUUID()}.xlsx`;
    await storage.put(key, buffer);
    const { stagingId } = await staging.stage(TENANT_A, USER_ID, {
      workbook_storage_key: key,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: false,
      errors: [],
      warnings: [],
    });
    const snapshot = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_A,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.FAILED,
        requested_by_user_id: USER_ID,
      }),
    );
    const job = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_A,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: USER_ID,
        staging_id: stagingId,
        snapshot_job_id: snapshot.id,
      }),
    );

    await processor.process(fakeJob(job.id));

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: job.id } });
    expect(finished.status).toBe(WorkbookJobStatus.FAILED);
    expect(finished.error).toBe('SNAPSHOT_FAILED');

    const school = await dataSource
      .getRepository(School)
      .findOneOrFail({ where: { id: TENANT_A } });
    expect(school.name).not.toBe('Should not apply');

    // The stage must not have been consumed — nothing downstream ran.
    const stillStaged = await staging.peek(TENANT_A, USER_ID, stagingId);
    expect(stillStaged).not.toBeNull();
  });

  it('the #693 seam: stages a real validation, consumes it in the processor, and the downloaded buffer round-trips to real typed rows via ValidationService.validate', async () => {
    const yearId = randomUUID();
    const buffer = await buildWorkbook({
      school: { id: TENANT_A, name: 'Seam Test School' },
      years: [
        {
          id: yearId,
          name: 'Seam Year',
          start: '2028-01-01',
          end: '2028-12-31',
          is_current: false,
        },
      ],
    });

    const job = await setupRestoreJob(TENANT_A, buffer);

    const validateSpy = vi.spyOn(validationService, 'validate');

    await processor.process(fakeJob(job.id));

    expect(validateSpy).toHaveBeenCalledWith(expect.any(Buffer), TENANT_A, dataSource.manager);
    const [passedBuffer] = validateSpy.mock.calls[0];
    expect((passedBuffer as Buffer).equals(buffer)).toBe(true);

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: job.id } });
    expect(finished.status).toBe(WorkbookJobStatus.DONE);

    // `academic_years.tab.ts`'s `upsert` never carries the workbook's own id
    // over on create (a fresh row always gets a new server-generated uuid —
    // see the tenant-isolation test above), so look the row up by its
    // natural key instead of the id from the fixture.
    const year = await dataSource
      .getRepository(AcademicYear)
      .findOneOrFail({ where: { tenant_id: TENANT_A, name: 'Seam Year' } });
    expect(year.name).toBe('Seam Year');

    validateSpy.mockRestore();
  });
});
