import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataSource, In } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  UserRole,
  StaffDocumentType,
  StaffEmploymentStatus,
  TeacherDesignation,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { StaffProfile } from '../src/modules/staff-profiles/entities/staff-profile.entity';
import { StaffDocument } from '../src/modules/staff-hr/entities/staff-document.entity';
import { StaffEducation } from '../src/modules/staff-hr/entities/staff-education.entity';
import { StaffDesignationHistory } from '../src/modules/staff-hr/entities/staff-designation-history.entity';
import { Designation } from '../src/modules/staff-hr/entities/designation.entity';
import { ImportStagingService } from '../src/modules/bulk-import/import-staging.service';
import { ValidationService } from '../src/modules/workbook/import/validation.service';
import { ExportProcessor } from '../src/modules/workbook/export/export.processor';
import { RestoreProcessor } from '../src/modules/workbook/restore/restore.processor';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../src/modules/workbook/jobs/workbook-job.entity';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

class FakeStorageService {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<{ body: AsyncIterable<Buffer> }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`FakeStorageService: no object at "${key}"`);
    return {
      body: (async function* () {
        yield body;
      })(),
    };
  }
}

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

/** #2668: a removed member keeps a Teacher / Staff / Student / Guardian row; the export must still finish. */
describe('departed profile logins (#2668)', () => {
  let dataSource: DataSource;
  let storage: FakeStorageService;
  let staging: ImportStagingService;
  let validationService: ValidationService;
  let exportProcessor: ExportProcessor;
  let restoreProcessor: RestoreProcessor;
  const T = randomUUID();
  const EMPTY = randomUUID();
  const OPERATOR_ID = randomUUID();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    const auditService = new AuditService(dataSource.getRepository(AuditLog));
    storage = new FakeStorageService();
    staging = new ImportStagingService(new FakeRedis() as any);
    validationService = new ValidationService();
    exportProcessor = new ExportProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      auditService,
      { emitFinished: vi.fn() } as any,
      { enforce: vi.fn().mockResolvedValue(undefined) } as any,
      { isRestoring: vi.fn().mockResolvedValue(false) } as any,
    );
    restoreProcessor = new RestoreProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      staging,
      validationService,
      { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) } as any,
      auditService,
      { emitFinished: vi.fn() } as any,
      { release: vi.fn().mockResolvedValue(undefined) } as any,
      { isActive: vi.fn().mockResolvedValue(true) } as any,
    );
  }, 60_000);

  async function exportA(): Promise<Buffer> {
    const repo = dataSource.getRepository(WorkbookJob);
    const job = await repo.save(
      repo.create({
        tenant_id: T,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );
    await exportProcessor.process({
      data: { jobId: job.id, tenantId: T },
      opts: { attempts: 2 },
      attemptsMade: 0,
    } as any);
    const done = await repo.findOneOrFail({ where: { id: job.id } });
    expect(done.status).toBe(WorkbookJobStatus.DONE);
    return storage.objects.get(done.storage_key as string) as Buffer;
  }

  async function restoreIntoT(buffer: Buffer): Promise<WorkbookJob> {
    const repo = dataSource.getRepository(WorkbookJob);
    const stagingKey = `staging/${randomUUID()}.xlsx`;
    await storage.put(stagingKey, buffer);
    const { stagingId } = await staging.stage(T, OPERATOR_ID, {
      workbook_storage_key: stagingKey,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: false,
      errors: [],
      warnings: [],
    });
    const snapshot = await repo.save(
      repo.create({
        tenant_id: T,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.DONE,
        requested_by_user_id: OPERATOR_ID,
      }),
    );
    const job = await repo.save(
      repo.create({
        tenant_id: T,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: OPERATOR_ID,
        staging_id: stagingId,
        snapshot_job_id: snapshot.id,
      }),
    );
    await restoreProcessor.process({ data: { jobId: job.id, inviteUsers: false } } as any);
    return repo.findOneOrFail({ where: { id: job.id } });
  }

  /** Reads a sheet as header-keyed rows; `edit` may change cells before the file is written back. */
  async function sheetRows(
    buffer: Buffer,
    sheet: string,
    edit?: (row: Record<string, ExcelJS.Cell>) => void,
  ): Promise<{ rows: Array<Record<string, string>>; buffer: Buffer }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.getWorksheet(sheet)!;
    const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const rows: Array<Record<string, string>> = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const cells: Record<string, ExcelJS.Cell> = {};
      const plain: Record<string, string> = {};
      header.forEach((h, i) => {
        if (!h) return;
        cells[h] = r.getCell(i);
        plain[h] = r.getCell(i).value == null ? '' : String(r.getCell(i).value);
      });
      if (plain.id === 'SAMPLE') return;
      edit?.(cells);
      rows.push(plain);
    });
    return { rows, buffer: edit ? Buffer.from(await wb.xlsx.writeBuffer()) : buffer };
  }

  it('exports blank login cells, restore keeps the stored logins, and a new row needs one', async () => {
    const tag = T.slice(0, 8);
    const db = dataSource;
    await db
      .getRepository(School)
      .save(
        db
          .getRepository(School)
          .create({ id: T, name: `Departed Profiles ${tag}`, slug: `dp-${tag}` }),
      );
    await db
      .getRepository(School)
      .save(
        db.getRepository(School).create({ id: EMPTY, name: `Empty ${tag}`, slug: `dpe-${tag}` }),
      );
    await db.getRepository(User).save(
      db.getRepository(User).create({
        id: OPERATOR_ID,
        email: `dp2668-op-${tag}@test.com`,
        full_name: 'Operator',
        password_hash: 'x',
      }),
    );
    const year = await db.getRepository(AcademicYear).save(
      db.getRepository(AcademicYear).create({
        name: `2026-${tag}`,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: T,
      }),
    );
    const klass = await db.getRepository(Class).save(
      db.getRepository(Class).create({
        name: `Six-${tag}`,
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: T,
      }),
    );
    const section = await db.getRepository(ClassSection).save(
      db.getRepository(ClassSection).create({
        class_id: klass.id,
        section_name: 'A',
        capacity: null,
        tenant_id: T,
      }),
    );
    const mk = async (n: string, role: UserRole) => {
      const u = await db.getRepository(User).save(
        db.getRepository(User).create({
          email: `dp2668-${n}-${tag}@test.com`,
          full_name: `Dp2668 ${n}`,
          password_hash: 'x',
        }),
      );
      await db
        .getRepository(UserTenant)
        .save(db.getRepository(UserTenant).create({ user_id: u.id, tenant_id: T, role }));
      return u;
    };
    await mk('admin', UserRole.ADMIN);
    const tUser = await mk('teacher', UserRole.TEACHER);
    const sUser = await mk('staff', UserRole.OFFICE_STAFF);
    const stUser = await mk('student', UserRole.STUDENT);
    const gUser = await mk('guardian', UserRole.PARENT);
    const liveStudentUser = await mk('livestudent', UserRole.STUDENT);

    const teacher = await db.getRepository(Teacher).save(
      db.getRepository(Teacher).create({
        user_id: tUser.id,
        employee_id: `EMP-T-${tag}`,
        designations: [TeacherDesignation.SUBJECT_TEACHER],
        tenant_id: T,
      }),
    );
    const profile = await db.getRepository(StaffProfile).save(
      db.getRepository(StaffProfile).create({
        user_id: sUser.id,
        employee_id: `EMP-S-${tag}`,
        tenant_id: T,
      }),
    );
    await db.getRepository(StaffDocument).save(
      db.getRepository(StaffDocument).create({
        tenant_id: T,
        staff_user_id: sUser.id,
        document_type: StaffDocumentType.NID,
        storage_key: `tenants/${T}/staff-documents/${sUser.id}/nid.pdf`,
        original_filename: 'nid.pdf',
        content_type: 'application/pdf',
      }),
    );
    const designation = await db
      .getRepository(Designation)
      .save(db.getRepository(Designation).create({ tenant_id: T, title_en: `Clerk ${tag}` }));
    await db.getRepository(StaffDesignationHistory).save(
      db.getRepository(StaffDesignationHistory).create({
        tenant_id: T,
        user_id: sUser.id,
        designation_id: designation.id,
        effective_date: '2026-01-01' as unknown as Date,
        status: StaffEmploymentStatus.REGULAR,
      }),
    );
    const education = await db.getRepository(StaffEducation).save(
      db.getRepository(StaffEducation).create({
        tenant_id: T,
        staff_user_id: sUser.id,
        degree: 'BSc',
        institution: 'Uni',
      }),
    );
    const mkStudent = (n: string, userId: string, roll: number) =>
      db.getRepository(Student).save(
        db.getRepository(Student).create({
          full_name: `Dp2668 ${n}`,
          registration_number: `REG-${n}-${tag}`,
          roll_number: roll,
          class_section_id: section.id,
          user_id: userId,
          tenant_id: T,
        }),
      );
    const student = await mkStudent('dep', stUser.id, 1);
    const liveStudent = await mkStudent('live', liveStudentUser.id, 2);
    const guardian = await db.getRepository(Guardian).save(
      db.getRepository(Guardian).create({
        full_name: 'Dp2668 Guardian',
        relationship: 'Father',
        phone: '01700000000',
        user_id: gUser.id,
        tenant_id: T,
      }),
    );

    // What `UsersService.endMembership` does: the profile rows stay.
    await db
      .getRepository(UserTenant)
      .softDelete({ tenant_id: T, user_id: In([tUser.id, sUser.id, stUser.id, gUser.id]) });

    const buffer = await exportA();

    for (const [sheet, col] of [
      ['teachers', 'user'],
      ['staff_profiles', 'user'],
      ['staff_documents', 'staff'],
      ['staff_designation_history', 'staff'],
      ['staff_education', 'staff'],
      ['guardians', 'user'],
    ] as const) {
      const { rows } = await sheetRows(buffer, sheet);
      // (The teacher's own staff profile is auto-created, so a sheet may hold more than one row.)
      expect(rows.length, `${sheet} rows`).toBeGreaterThan(0);
      expect(
        rows.map((r) => r[col]),
        `${sheet}.${col}`,
      ).toEqual(rows.map(() => ''));
    }
    const studentRows = (await sheetRows(buffer, 'students')).rows;
    expect(studentRows.find((r) => r.id === student.id)!.user).toBe('');
    expect(studentRows.find((r) => r.id === liveStudent.id)!.user).toBe(liveStudentUser.email);

    // Same school: zero errors, then the restore keeps every departed login.
    const same = await validationService.validate(buffer, T, db.manager);
    const tabs = [
      'teachers',
      'staff_profiles',
      'staff_documents',
      'staff_designation_history',
      'staff_education',
      'students',
      'guardians',
    ];
    expect(same.errors.filter((e) => e.severity === 'error' && tabs.includes(e.tab))).toEqual([]);
    expect((await restoreIntoT(buffer)).status).toBe(WorkbookJobStatus.DONE);
    expect((await db.getRepository(Teacher).findOneByOrFail({ id: teacher.id })).user_id).toBe(
      tUser.id,
    );
    expect((await db.getRepository(StaffProfile).findOneByOrFail({ id: profile.id })).user_id).toBe(
      sUser.id,
    );
    expect(
      (await db.getRepository(StaffEducation).findOneByOrFail({ id: education.id })).staff_user_id,
    ).toBe(sUser.id);
    expect((await db.getRepository(Student).findOneByOrFail({ id: student.id })).user_id).toBe(
      stUser.id,
    );
    expect((await db.getRepository(Student).findOneByOrFail({ id: liveStudent.id })).user_id).toBe(
      liveStudentUser.id,
    );
    expect((await db.getRepository(Guardian).findOneByOrFail({ id: guardian.id })).user_id).toBe(
      gUser.id,
    );
    expect(await db.getRepository(StaffDocument).count({ where: { tenant_id: T } })).toBe(1);

    // Blank on a CURRENT login means clear (D12); the departed one stays.
    const edited = await sheetRows(buffer, 'students', (c) => {
      if (c.id.value === liveStudent.id) c.user.value = null;
    });
    expect((await restoreIntoT(edited.buffer)).status).toBe(WorkbookJobStatus.DONE);
    expect(
      (await db.getRepository(Student).findOneByOrFail({ id: liveStudent.id })).user_id,
    ).toBeNull();
    expect((await db.getRepository(Student).findOneByOrFail({ id: student.id })).user_id).toBe(
      stUser.id,
    );

    // Empty school: a new teacher row needs a login; a new student/guardian row does not.
    const empty = await validationService.validate(buffer, EMPTY, db.manager);
    const hard = empty.errors.filter((e) => e.severity === 'error');
    expect(hard.find((e) => e.tab === 'teachers' && e.column === 'user')?.message).toBe(
      'Choose a current staff member for this row; a new row needs one.',
    );
    expect(
      hard.filter((e) => (e.tab === 'students' || e.tab === 'guardians') && e.column === 'user'),
    ).toEqual([]);
  }, 120_000);
});
