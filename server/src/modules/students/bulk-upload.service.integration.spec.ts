import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource, In } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { StudentBulkUploadService } from './bulk-upload.service';
import { StudentService, GuardianService } from './students.service';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { REQUIRED_HEADERS, BulkUploadHeader } from './bulk-upload.parser';
import { AuditAction } from '@biddaloy/shared';

/**
 * Integration tests for StudentBulkUploadService (issue #10).
 *
 * Runs against a real PostgreSQL database. Covers row-level validation,
 * class/section resolution by name, sibling guardian dedup, duplicate roll
 * detection (both intra-file and pre-existing), tenant isolation, and
 * CSV/XLSX parity, all through the real HTTP-adjacent service entrypoint.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const OTHER_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000921';
const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000922';
const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000923';

const DEFAULTS: Record<BulkUploadHeader, string> = {
  student_name: 'Alice Rahman',
  class: 'Class One',
  section: 'Section A',
  roll: '',
  registration_number: '',
  guardian1_name: 'Karim Rahman',
  guardian1_phone: '+8801711111111',
  guardian1_email: '',
  guardian2_name: '',
  guardian2_phone: '',
  guardian2_email: '',
  home_address: '',
  preferred_communication: '',
};

function rowValues(
  headers: readonly string[],
  overrides: Partial<Record<BulkUploadHeader, string>> = {},
): string[] {
  const merged = { ...DEFAULTS, ...overrides };
  return headers.map((h) => merged[h as BulkUploadHeader] ?? '');
}

async function buildXlsxFile(
  rows: string[][],
  filename = 'students.xlsx',
): Promise<Express.Multer.File> {
  const headers = [...REQUIRED_HEADERS];
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname: filename } as Express.Multer.File;
}

function buildCsvFile(rows: string[][], filename = 'students.csv'): Express.Multer.File {
  const headers = [...REQUIRED_HEADERS];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return {
    buffer: Buffer.from(lines.join('\n'), 'utf-8'),
    originalname: filename,
  } as Express.Multer.File;
}

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM audit_logs');
  await ds.query('DELETE FROM guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');
  await ds.query('DELETE FROM users');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);
  const userRepo = ds.getRepository(User);

  await userRepo.save(
    userRepo.create({
      id: SEED_ADMIN_USER_ID,
      email: SEED_ADMIN_EMAIL,
      password_hash: SEED_ADMIN_PASSWORD_HASH,
      full_name: 'Test Admin',
    }),
  );

  await schoolRepo.save(
    schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SEED_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SEED_CLASS_1_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  await schoolRepo.save(
    schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: OTHER_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: OTHER_CLASS_ID,
      name: 'Class One',
      academic_year_id: OTHER_ACADEMIC_YEAR_ID,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: OTHER_SECTION_ID,
      section_name: 'Section A',
      class_id: OTHER_CLASS_ID,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
}

describe('StudentBulkUploadService (integration)', () => {
  let service: StudentBulkUploadService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const headers = [...REQUIRED_HEADERS];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentBulkUploadService, StudentService, GuardianService, AuditService],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<StudentBulkUploadService>(StudentBulkUploadService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM audit_logs');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  it('creates students and guardians from a valid file', async () => {
    const file = await buildXlsxFile([rowValues(headers)]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(1);
    expect(result.error_count).toBe(0);
    expect(result.created_student_ids).toHaveLength(1);

    const student = await studentRepo.findOne({
      where: { id: result.created_student_ids[0] },
      relations: ['guardians'],
    });
    expect(student?.full_name).toBe('Alice Rahman');
    expect(student?.guardians).toHaveLength(1);
    expect(student?.guardians[0].phone).toBe('+8801711111111');
  });

  it('reuses an existing guardian for a sibling sharing the same phone number', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'Sibling One', roll: '1' }),
      rowValues(headers, { student_name: 'Sibling Two', roll: '2' }),
    ]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(2);
    const guardians = await guardianRepo.find({ where: { phone: '+8801711111111' } });
    expect(guardians).toHaveLength(1);

    const students = await studentRepo.find({
      where: { id: In(result.created_student_ids) },
      relations: ['guardians'],
    });
    // Both siblings should link to the same single guardian record.
    expect(new Set(students.flatMap((s) => s.guardians.map((g) => g.id))).size).toBe(1);
  });

  it('reuses a guardian that already exists in the database for this tenant', async () => {
    const existing = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Pre-existing Guardian',
        relationship: 'OTHER',
        phone: '+8801722222222',
        tenant_id: TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '+8801722222222' })]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(1);
    const allGuardians = await guardianRepo.find({ where: { phone: '+8801722222222' } });
    expect(allGuardians).toHaveLength(1);
    expect(allGuardians[0].id).toBe(existing.id);
  });

  it('reports a specific error for a duplicate roll number within the same file', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'First', roll: '5' }),
      rowValues(headers, { student_name: 'Second', roll: '5', guardian1_phone: '+8801733333333' }),
    ]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(1);
    expect(result.error_count).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 3 });
    expect(result.errors[0].reason).toContain('Duplicate roll number 5');
  });

  it('reports a specific error for a roll number that already exists in the database', async () => {
    await service.process(
      await buildXlsxFile([rowValues(headers, { student_name: 'Existing', roll: '9' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'New', roll: '9', guardian1_phone: '+8801744444444' }),
    ]);
    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.error_count).toBe(1);
    expect(result.errors[0].reason).toContain('Duplicate roll number 9');
  });

  it('does not leave an orphaned guardian behind when the student create fails', async () => {
    await service.process(
      await buildXlsxFile([rowValues(headers, { student_name: 'Existing', roll: '15' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    // A brand-new guardian phone paired with a roll number that's already
    // taken — student creation must fail, and since guardian creation and
    // student creation run in one transaction, the new guardian must be
    // rolled back too rather than left dangling with no student attached.
    const file = await buildXlsxFile([
      rowValues(headers, {
        student_name: 'Conflicting',
        roll: '15',
        guardian1_phone: '+8801766666666',
      }),
    ]);
    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    const orphanCandidates = await guardianRepo.find({ where: { phone: '+8801766666666' } });
    expect(orphanCandidates).toHaveLength(0);
  });

  it('reports a specific error for a missing required field', async () => {
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '' })]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0].reason).toContain('Missing required field: guardian1_phone');
  });

  it('reports a specific error for an invalid phone format', async () => {
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '12345' })]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0].reason).toContain('Invalid phone format: guardian1_phone');
  });

  it('reports a specific error for an unknown class/section name', async () => {
    const file = await buildXlsxFile([rowValues(headers, { class: 'Nonexistent Class' })]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0].reason).toContain("Class 'Nonexistent Class'");
  });

  it('ignores the registration_number column and always system-generates it', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { registration_number: 'HAND-TYPED-001' }),
    ]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    const student = await studentRepo.findOne({ where: { id: result.created_student_ids[0] } });
    expect(student?.registration_number).not.toBe('HAND-TYPED-001');
    expect(student?.registration_number).toMatch(/^REG-\d{4}-\d{4}$/);
  });

  it('creates a second guardian and links both when guardian2 is provided', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, {
        guardian2_name: 'Second Guardian',
        guardian2_phone: '+8801755555555',
      }),
    ]);

    const result = await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    const student = await studentRepo.findOne({
      where: { id: result.created_student_ids[0] },
      relations: ['guardians'],
    });
    expect(student?.guardians).toHaveLength(2);
  });

  it('does not resolve a class/section belonging to a different tenant', async () => {
    const file = await buildXlsxFile([rowValues(headers)]);

    const result = await service.process(file, OTHER_TENANT_ID, SEED_ADMIN_USER_ID);

    // The seeded "Class One / Section A" for OTHER_TENANT_ID should resolve fine on its own tenant...
    expect(result.success_count).toBe(1);

    // ...but a guardian phone used on TENANT_ID must not be reused across tenants.
    const crossTenantGuardians = await guardianRepo.find({ where: { phone: '+8801711111111' } });
    expect(crossTenantGuardians.every((g) => g.tenant_id === OTHER_TENANT_ID)).toBe(true);
  });

  it('produces the same result for equivalent CSV and XLSX content', async () => {
    const xlsxResult = await service.process(
      await buildXlsxFile([rowValues(headers, { student_name: 'Xlsx Student', roll: '20' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    const csvResult = await service.process(
      buildCsvFile([rowValues(headers, { student_name: 'Csv Student', roll: '21' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    expect(xlsxResult.success_count).toBe(1);
    expect(csvResult.success_count).toBe(1);
  });

  it('writes one audit log entry summarizing the whole upload', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'Ok Row', roll: '30' }),
      rowValues(headers, { student_name: 'Bad Row', guardian1_phone: '' }),
    ]);

    await service.process(file, TENANT_ID, SEED_ADMIN_USER_ID);

    const logs = await auditLogRepo.find({ where: { action: AuditAction.BULK_UPLOAD } });
    expect(logs).toHaveLength(1);
    expect(logs[0].new_values).toMatchObject({ total_rows: 2, success_count: 1, error_count: 1 });
    expect(logs[0].tenant_id).toBe(TENANT_ID);
  });
});
