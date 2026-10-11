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
import { Class } from '../../academics/entities/class.entity';
import { Exam } from '../../exams/entities/exam.entity';
import { classesTab } from '../tabs/academics/classes.tab';
import { examsTab } from '../tabs/exams/exams.tab';
import ExcelJS from 'exceljs';
import { ExportProcessor } from '../export/export.processor';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { FeeStructure } from '../../fees/entities/fee-structure.entity';
import { StudentFee } from '../../fees/entities/student-fee.entity';
import { Payment } from '../../fees/entities/payment.entity';
import { PaymentAllocation } from '../../fees/entities/payment-allocation.entity';
import { ExamComponent } from '../../exams/entities/exam-component.entity';
import { Mark } from '../../exams/entities/mark.entity';
import { GradingScale } from '../../grading/entities/grading-scale.entity';
import { GradingBand } from '../../grading/entities/grading-band.entity';
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
 * S3 needed to exercise the real read/write round trip. */
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

  // D13: exams stand in for every insert-only tab (payments, allocations,
  // bills, marks, ...) — they all share the processor/validation path.
  describe('insert-only tabs (D13)', () => {
    const YEAR = 'D13 Year';
    const CLASS = 'D13 Class';

    async function seedTenant() {
      const tenantId = randomUUID();
      await dataSource.getRepository(School).save(
        dataSource.getRepository(School).create({
          id: tenantId,
          name: `D13 School ${tenantId.slice(0, 6)}`,
          slug: `d13-${tenantId.slice(0, 8)}`,
        }),
      );
      const year = await dataSource.getRepository(AcademicYear).save(
        dataSource.getRepository(AcademicYear).create({
          tenant_id: tenantId,
          name: YEAR,
          start_date: new Date(2024, 0, 1),
          end_date: new Date(2024, 11, 31),
          is_current: false,
        }),
      );
      const cls = await dataSource.getRepository(Class).save(
        dataSource.getRepository(Class).create({
          tenant_id: tenantId,
          name: CLASS,
          academic_year_id: year.id,
        }),
      );
      const exam = (name: string, status: string) =>
        dataSource.getRepository(Exam).save(
          dataSource.getRepository(Exam).create({
            tenant_id: tenantId,
            academic_year_id: year.id,
            class_id: cls.id,
            name,
            kind: 'TERM' as never,
            status: status as never,
          }),
        );
      return { tenantId, year, cls, exam };
    }

    async function examWorkbook(
      tenantId: string,
      year: AcademicYear,
      cls: Class,
      exams: Array<{ id: string; name: string; status: string }>,
    ): Promise<Buffer> {
      return writeWorkbook({
        tabs: [academicYearsTab, classesTab, examsTab],
        meta: {
          schema_version: SCHEMA_VERSION,
          kind: 'BACKUP',
          exported_at: new Date().toISOString(),
          app_version: 'test',
          source_school_name: 'x',
          source_school_slug: 'x',
        },
        rowsFor: async function* (tab) {
          if (tab.name === 'academic_years') {
            yield {
              id: year.id,
              name: YEAR,
              start_date: '2024-01-01',
              end_date: '2024-12-31',
              is_current: false,
            };
          } else if (tab.name === 'classes') {
            yield { id: cls.id, name: CLASS, academic_year: YEAR, shift: null, version: null };
          } else if (tab.name === 'exams') {
            for (const e of exams) {
              yield {
                id: e.id,
                name: e.name,
                academic_year: YEAR,
                class: `${CLASS}|${YEAR}||`,
                kind: 'TERM',
                status: e.status,
                published_at: null,
              };
            }
          }
        },
      });
    }

    it('refuses a workbook that changes an existing exam; nothing is written', async () => {
      const t = await seedTenant();
      const exam = await t.exam('Mid', 'PUBLISHED');
      const buffer = await examWorkbook(t.tenantId, t.year, t.cls, [
        { id: exam.id, name: 'Mid', status: 'DRAFT' },
      ]);
      const job = await setupRestoreJob(t.tenantId, buffer);
      await processor.process(fakeJob(job.id));

      const finished = await dataSource
        .getRepository(WorkbookJob)
        .findOneOrFail({ where: { id: job.id } });
      expect(finished.status).toBe(WorkbookJobStatus.FAILED);
      expect(finished.error).toContain('Re-validation found 1 error');
      const after = await dataSource.getRepository(Exam).findOneByOrFail({ id: exam.id });
      expect(after.status).toBe('PUBLISHED');
    });

    it('keeps an existing exam missing from the file, inserts a new one, and audits deletes of other tabs', async () => {
      const t = await seedTenant();
      await t.exam('Absent', 'PUBLISHED');
      const droppedYear = await dataSource.getRepository(AcademicYear).save(
        dataSource.getRepository(AcademicYear).create({
          tenant_id: t.tenantId,
          name: 'Dropped D13 Year',
          start_date: new Date(2020, 0, 1),
          end_date: new Date(2020, 11, 31),
          is_current: false,
        }),
      );
      const buffer = await examWorkbook(t.tenantId, t.year, t.cls, [
        { id: randomUUID(), name: 'Brand new', status: 'DRAFT' },
      ]);
      const job = await setupRestoreJob(t.tenantId, buffer);
      await processor.process(fakeJob(job.id));

      const finished = await dataSource
        .getRepository(WorkbookJob)
        .findOneOrFail({ where: { id: job.id } });
      expect(finished.status).toBe(WorkbookJobStatus.DONE);
      const names = (
        await dataSource.getRepository(Exam).find({ where: { tenant_id: t.tenantId } })
      )
        .map((e) => e.name)
        .sort();
      expect(names).toEqual(['Absent', 'Brand new']);
      expect(
        await dataSource.getRepository(AcademicYear).findOneBy({ id: droppedYear.id }),
      ).toBeNull();

      const [audit] = await dataSource.query(
        `SELECT new_values FROM audit_logs WHERE tenant_id = $1 AND new_values->>'workbook_job_id' = $2`,
        [t.tenantId, job.id],
      );
      expect(audit.new_values.deleted_counts).toEqual({ academic_years: 1 });
    });
  });

  // D13 on the real money/marks tabs: export a seeded tenant, edit the
  // workbook like an admin would in Excel, and restore it back.
  describe('money and marks are insert-only (D13, real tabs)', () => {
    let exporter: ExportProcessor;
    const em = () => dataSource.manager;

    beforeAll(() => {
      exporter = new ExportProcessor(
        dataSource.getRepository(WorkbookJob),
        dataSource,
        storage as any,
        auditService,
        { emitFinished: vi.fn() } as any,
        { enforce: vi.fn().mockResolvedValue(undefined) } as any,
        { isRestoring: vi.fn().mockResolvedValue(false) } as any,
      );
    });

    async function seed() {
      const tenantId = randomUUID();
      const t = { tenant_id: tenantId };
      await em().save(
        em().create(School, {
          id: tenantId,
          name: `D13R ${tenantId.slice(0, 6)}`,
          slug: `d13r-${tenantId.slice(0, 8)}`,
        }),
      );
      const year = await em().save(
        em().create(AcademicYear, {
          ...t,
          name: '2026-2027',
          start_date: '2026-01-01' as never,
          end_date: '2026-12-31' as never,
          is_current: true,
        }),
      );
      const cls = await em().save(
        em().create(Class, { ...t, name: 'Class 5', academic_year_id: year.id }),
      );
      const section = await em().save(
        em().create(ClassSection, { ...t, class_id: cls.id, section_name: 'A', capacity: 40 }),
      );
      const student = await em().save(
        em().create(Student, {
          ...t,
          full_name: 'S One',
          registration_number: 'R-1',
          roll_number: 1,
          class_section_id: section.id,
        }),
      );
      const structure = await em().save(
        em().create(FeeStructure, {
          ...t,
          fee_type: 'MONTHLY_TUITION' as never,
          name: 'Tuition',
          amount: '1500.00' as never,
          class_id: cls.id,
          academic_year_id: year.id,
        }),
      );
      const fee = async (periodStart: string) =>
        em().save(
          em().create(StudentFee, {
            ...t,
            student_id: student.id,
            academic_year_id: year.id,
            fee_structure_id: structure.id,
            period_start: periodStart as never,
            total_amount: 1000 as never,
            paid_amount: 0 as never,
            status: 'PENDING' as never,
          }),
        );
      const fee1 = await fee('2026-01-01');
      const fee2 = await fee('2026-02-01');
      const payment = await em().save(
        em().create(Payment, {
          ...t,
          student_id: student.id,
          total_amount: 600 as never,
          payment_method: 'CASH' as never,
          payment_status: 'SUCCESS' as never,
          transaction_reference: 'TXN-1',
          payment_date: new Date('2026-01-06T10:00:00Z'),
        }),
      );
      const alloc = (feeId: string) =>
        em().save(
          em().create(PaymentAllocation, {
            payment_id: payment.id,
            student_fee_id: feeId,
            allocated_amount: 300 as never,
            allocation_type: 'CURRENT' as never,
          } as never),
        );
      const a1 = await alloc(fee1.id);
      const a2 = await alloc(fee2.id);
      const exam = await em().save(
        em().create(Exam, {
          ...t,
          academic_year_id: year.id,
          class_id: cls.id,
          name: 'Mid',
          kind: 'TERM' as never,
          status: 'PUBLISHED' as never,
        }),
      );
      const subject = await em().save(
        em().create(Subject, { ...t, name_en: 'Math', code: 'MATH' }),
      );
      const component = await em().save(
        em().create(ExamComponent, {
          ...t,
          exam_id: exam.id,
          subject_id: subject.id,
          name: 'Written',
          kind: 'WRITTEN' as never,
          full_marks: '100' as never,
          pass_marks: '33' as never,
          sequence: 1,
        }),
      );
      const scale = await em().save(
        em().create(GradingScale, { ...t, academic_year_id: year.id, name: 'Scale' }),
      );
      const band = await em().save(
        em().create(GradingBand, {
          ...t,
          scale_id: scale.id,
          percent_from: 80,
          percent_to: 100,
          grade: 'A+',
          gpa: '5.00',
          is_fail: false,
          sequence: 1,
        }),
      );
      const mark = await em().save(
        em().create(Mark, {
          ...t,
          exam_id: exam.id,
          student_id: student.id,
          subject_id: subject.id,
          component_id: component.id,
          value: '38' as never,
          status: 'PRESENT' as never,
        }),
      );
      return { tenantId, student, fee1, a1, a2, mark, payment, component, band };
    }

    /** Runs a real export of the tenant and returns the workbook bytes. */
    async function exportTenant(tenantId: string): Promise<Buffer> {
      const job = await dataSource.getRepository(WorkbookJob).save(
        dataSource.getRepository(WorkbookJob).create({
          tenant_id: tenantId,
          kind: WorkbookJobKind.EXPORT,
          source: WorkbookJobSource.MANUAL,
          status: WorkbookJobStatus.QUEUED,
          requested_by_user_id: null,
        }),
      );
      await exporter.process({
        data: { jobId: job.id, tenantId },
        opts: { attempts: 2 },
        attemptsMade: 0,
      } as never);
      const done = await dataSource.getRepository(WorkbookJob).findOneByOrFail({ id: job.id });
      expect(done.status).toBe(WorkbookJobStatus.DONE);
      return storage.objects.get(done.storage_key as string) as Buffer;
    }

    /** Edit a workbook the way a person would: set cells / drop rows. */
    async function edit(
      buffer: Buffer,
      fn: (
        sheet: (name: string) => { header: string[]; rows: ExcelJS.Row[]; ws: ExcelJS.Worksheet },
      ) => void,
    ): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as never);
      fn((name) => {
        const ws = wb.getWorksheet(name)!;
        const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
        const rows: ExcelJS.Row[] = [];
        ws.eachRow((r, n) => n > 1 && rows.push(r));
        return { header, rows, ws };
      });
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    const col = (h: string[], k: string) => h.indexOf(k) + 1;

    async function restore(tenantId: string, buffer: Buffer): Promise<WorkbookJob> {
      const job = await setupRestoreJob(tenantId, buffer);
      await processor.process(fakeJob(job.id));
      return dataSource.getRepository(WorkbookJob).findOneByOrFail({ id: job.id });
    }

    it('round trip: restoring an untouched export of the same tenant has 0 errors and changes nothing', async () => {
      const d = await seed();
      const job = await restore(d.tenantId, await exportTenant(d.tenantId));
      expect(job.error).toBeNull();
      expect(job.status).toBe(WorkbookJobStatus.DONE);
      expect((await em().findOneByOrFail(Mark, { id: d.mark.id })).value).toBe('38.00');
    });

    it('GAP-01: an allocation missing from the file is kept', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const { header, rows, ws } = sheet('payment_allocations');
        const row = rows.find((r) => r.getCell(col(header, 'id')).value === d.a2.id)!;
        ws.spliceRows(row.number, 1);
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.status).toBe(WorkbookJobStatus.DONE);
      expect(await em().findOneBy(PaymentAllocation, { id: d.a2.id })).not.toBeNull();
    });

    it('DATA-03: changing a mark (38 to 78) and a bill paid_amount (0 to 2500) is refused; values unchanged', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const m = sheet('marks');
        m.rows[0].getCell(col(m.header, 'value')).value = '78';
        const f = sheet('student_fees');
        f.rows[0].getCell(col(f.header, 'paid_amount')).value = '2500';
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.status).toBe(WorkbookJobStatus.FAILED);
      expect((await em().findOneByOrFail(Mark, { id: d.mark.id })).value).toBe('38.00');
      expect(Number((await em().findOneByOrFail(StudentFee, { id: d.fee1.id })).paid_amount)).toBe(
        0,
      );
    });

    // Review r1 #2: what grades a mark is as frozen as the mark. Changing a
    // band or a component's pass mark by restore would skip the D16 refusal,
    // the approval and the recompute the app runs for the same edit.
    it('changing a grading band grade (A+ to A) is refused; band unchanged', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const b = sheet('grading_bands');
        b.rows[0].getCell(col(b.header, 'grade')).value = 'A';
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.status).toBe(WorkbookJobStatus.FAILED);
      expect((await em().findOneByOrFail(GradingBand, { id: d.band.id })).grade).toBe('A+');
    });

    it('changing an exam component pass mark (33 to 50) is refused; component unchanged', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const c = sheet('exam_components');
        c.rows[0].getCell(col(c.header, 'pass_marks')).value = '50';
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.status).toBe(WorkbookJobStatus.FAILED);
      expect((await em().findOneByOrFail(ExamComponent, { id: d.component.id })).pass_marks).toBe(
        '33.00',
      );
    });

    // Review r1 #3: leaving a student out of the file would soft-delete them,
    // skipping StudentService.remove's STUDENT_HAS_OPEN_MONEY refusal.
    it('a student with an open bill who is missing from the file is refused; student kept', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const st = sheet('students');
        st.ws.spliceRows(st.rows[0].number, 1);
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.status).toBe(WorkbookJobStatus.FAILED);
      const student = await em().findOne(Student, { where: { id: d.student.id }, withDeleted: true });
      expect(student?.deleted_at).toBeNull();
    });

    it('a new payment with its allocation in the file is inserted', async () => {
      const d = await seed();
      const buffer = await edit(await exportTenant(d.tenantId), (sheet) => {
        const p = sheet('payments');
        const cells = (p.rows[0].values as unknown[]).slice(1);
        cells[p.header.indexOf('id')] = randomUUID();
        cells[p.header.indexOf('transaction_reference')] = 'TXN-NEW';
        p.ws.addRow(cells);
        const a = sheet('payment_allocations');
        const ac = (a.rows[0].values as unknown[]).slice(1);
        ac[a.header.indexOf('id')] = randomUUID();
        ac[a.header.indexOf('payment')] = 'TXN-NEW';
        a.ws.addRow(ac);
      });
      const job = await restore(d.tenantId, buffer);
      expect(job.error).toBeNull();
      expect(job.status).toBe(WorkbookJobStatus.DONE);
      expect(await em().countBy(Payment, { tenant_id: d.tenantId })).toBe(2);
    });
  });
});
