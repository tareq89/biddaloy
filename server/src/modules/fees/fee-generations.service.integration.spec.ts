import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeGenerationsService } from './fee-generations.service';
import { FeeGeneration } from './entities/fee-generation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { PeriodType, FeeType, FeeGenerationSource, DuplicateStrategy } from '@biddaloy/shared';

/**
 * Integration tests for FeeGenerationsService (16.1.4).
 *
 * Runs against a real PostgreSQL database. Verifies `create()` writes both
 * the batch row and its audit entry inside the caller's transaction, and
 * that the `findAll` aggregate (billed/collected amounts, per-batch bill
 * counts) matches summing the batch's own bills directly.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

let studentSeq = 0;
// Re-seeded per test — `student_fees.fee_structure_id` is NOT NULL (16.1.3).
let feeStructureId: string;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM audit_logs');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM fee_generations');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM users');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);
  const userRepo = ds.getRepository(User);

  await schoolRepo.save(
    schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
  );
  await userRepo.save(
    userRepo.create({
      id: SEED_ADMIN_USER_ID,
      email: SEED_ADMIN_EMAIL,
      password_hash: SEED_ADMIN_PASSWORD_HASH,
      full_name: 'Test Admin',
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SEED_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2020-01-01'),
      end_date: new Date('2035-12-31'),
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
}

describe('FeeGenerationsService (integration)', () => {
  let service: FeeGenerationsService;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let generationRepo: Repository<FeeGeneration>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  function makeStudent() {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-FGEN-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
    });
  }

  const baseInput = {
    tenant_id: TENANT_ID,
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
    period_start: '2026-07-01',
    period_type: PeriodType.MONTH,
    due_date: '2026-07-10',
    source: FeeGenerationSource.MANUAL,
    duplicate_strategy: DuplicateStrategy.SKIP,
    notify_families: false,
    structures: [{ id: 'fs-1', name: 'Tuition', fee_type: 'MONTHLY_TUITION', amount: 1000 }],
    student_count: 1,
    generated_count: 1,
    skipped_count: 0,
    removed_count: 0,
  };

  beforeAll(async () => {
    // No `{ synchronize: true, dropSchema: true }` here, unlike sibling fee
    // specs: this test needs `student_fees.fee_generation_id`, a column
    // this ticket's migration adds — `StudentFee` (owned by a parallel
    // lane, #640) doesn't declare it as an entity property yet, so a
    // schema rebuilt from entity metadata alone would omit it. Connecting
    // without those options uses the already-migrated test database
    // instead (see `test/global-setup.ts`), which has the real column.
    const module = await createTestModule(ALL_ENTITIES, [FeeGenerationsService, AuditService]);

    service = module.get<FeeGenerationsService>(FeeGenerationsService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    generationRepo = module.get<Repository<FeeGeneration>>(getRepositoryToken(FeeGeneration));
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
      await dataSource.query('DELETE FROM audit_logs');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM fee_generations');
      await dataSource.query('DELETE FROM students');
      // `fee_structures` is truncated globally by `test/setup.ts` before this
      // hook, so re-seed the price tag this file's bills are charged against.
      const feeStructureRepo = dataSource.getRepository(FeeStructure);
      feeStructureId = (
        await feeStructureRepo.save(
          feeStructureRepo.create({
            name: 'Tuition',
            fee_type: FeeType.MONTHLY_TUITION,
            amount: '1000.00',
            class_id: SEED_CLASS_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            tenant_id: SEED_TENANT_ID,
          }),
        )
      ).id;
    }
  });

  describe('create', () => {
    it('writes the batch row and a FeeGeneration audit entry inside the same transaction', async () => {
      const batch = await dataSource.transaction(async (manager) => {
        return service.create({ ...baseInput, generated_by_user_id: SEED_ADMIN_USER_ID }, manager);
      });

      const saved = await generationRepo.findOne({ where: { id: batch.id } });
      expect(saved).toBeDefined();
      expect(saved!.tenant_id).toBe(TENANT_ID);
      expect(saved!.student_count).toBe(1);

      const auditRow = await auditLogRepo.findOne({
        where: { entity_type: 'FeeGeneration', entity_id: batch.id },
      });
      expect(auditRow).toBeDefined();
      expect(auditRow!.tenant_id).toBe(TENANT_ID);
    });

    it('rolls back the batch row if the transaction fails after create()', async () => {
      let batchId: string | undefined;
      await expect(
        dataSource.transaction(async (manager) => {
          const batch = await service.create({ ...baseInput }, manager);
          batchId = batch.id;
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');

      const saved = await generationRepo.findOne({ where: { id: batchId! } });
      expect(saved).toBeNull();
    });
  });

  describe('findAll aggregate', () => {
    it('matches summing the batch bills directly', async () => {
      const batch = await dataSource.transaction((manager) =>
        service.create({ ...baseInput, student_count: 3, generated_count: 3 }, manager),
      );

      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      const s3 = await studentRepo.save(makeStudent());

      // Raw SQL, not `studentFeeRepo.create()`/`save()`: `fee_generation_id`
      // is a real DB column (this ticket's migration) but not yet a mapped
      // property on the `StudentFee` entity (owned by parallel lane #640),
      // so TypeORM would silently drop it from a repository-level save.
      const bills = [
        { studentId: s1.id, paid: 1000, status: 'PAID' },
        { studentId: s2.id, paid: 400, status: 'PARTIALLY_PAID' },
        { studentId: s3.id, paid: 0, status: 'PENDING' },
      ];
      for (const b of bills) {
        await dataSource.query(
          // `month`/`year` are generated columns derived from `period_start`
          // (16.1.3), so the period is what gets inserted.
          `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, fee_generation_id, created_at, updated_at)
           VALUES (DEFAULT, $1, $2, $6, DATE '2026-07-01', 1000, $3, 0, $4, $5, NOW(), NOW())`,
          [b.studentId, SEED_ACADEMIC_YEAR_ID, b.paid, b.status, batch.id, feeStructureId],
        );
      }

      const directBills = await dataSource.query(
        `SELECT total_amount, paid_amount FROM student_fees WHERE fee_generation_id = $1`,
        [batch.id],
      );
      const expectedBilled = directBills.reduce(
        (sum: number, b: any) => sum + Number(b.total_amount),
        0,
      );
      const expectedCollected = directBills.reduce(
        (sum: number, b: any) => sum + Number(b.paid_amount),
        0,
      );

      const page = await service.findAll({ page: 1, limit: 20 } as any, TENANT_ID);
      const entry = page.data.find((d) => d.id === batch.id)!;

      expect(entry.billed_amount).toBe(expectedBilled);
      expect(entry.collected_amount).toBe(expectedCollected);
      expect(entry.collection_status).toBe('PARTIAL');
    });

    it('excludes soft-deleted bills from totals but still returns the batch', async () => {
      const batch = await dataSource.transaction((manager) =>
        service.create({ ...baseInput, student_count: 1, generated_count: 1 }, manager),
      );
      const student = await studentRepo.save(makeStudent());
      await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, fee_generation_id, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, DATE '2026-07-01', 1000, 0, 0, 'PENDING', $4, NOW(), NOW())`,
        [student.id, SEED_ACADEMIC_YEAR_ID, feeStructureId, batch.id],
      );
      await studentFeeRepo.softDelete({ fee_generation_id: batch.id });

      const page = await service.findAll({ page: 1, limit: 20 } as any, TENANT_ID);
      const entry = page.data.find((d) => d.id === batch.id)!;
      expect(entry).toBeDefined();
      expect(entry.billed_amount).toBe(0);
      expect(entry.collected_amount).toBe(0);
      expect(entry.collection_status).toBe('NONE');
    });

    it('findBills excludes soft-deleted bills', async () => {
      const batch = await dataSource.transaction((manager) =>
        service.create({ ...baseInput, student_count: 1, generated_count: 1 }, manager),
      );
      const student = await studentRepo.save(makeStudent());
      await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, fee_generation_id, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, DATE '2026-07-01', 1000, 0, 0, 'PENDING', $4, NOW(), NOW())`,
        [student.id, SEED_ACADEMIC_YEAR_ID, feeStructureId, batch.id],
      );
      await studentFeeRepo.softDelete({ fee_generation_id: batch.id });

      const bills = await service.findBills(batch.id, { page: 1, limit: 20 } as any, TENANT_ID);
      expect(bills.data).toHaveLength(0);
    });
  });
});
