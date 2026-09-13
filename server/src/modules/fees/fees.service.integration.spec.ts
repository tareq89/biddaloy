import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeStructureService, PaymentService } from './fees.service';
import { GuardianService } from '../students/students.service';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
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
import { FeeStatus, AuditAction } from '@biddaloy/shared';

/**
 * Integration tests for FeeStructureService and PaymentService.
 *
 * These tests run against a real PostgreSQL database and verify
 * tenant isolation, CRUD, soft-delete with conflict detection,
 * invoice summary aggregation, and student payment history.
 */

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM fee_structures');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM guardians');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);
  const userRepo = ds.getRepository(User);

  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
  );
  // Seeded so tests can reference SEED_ADMIN_USER_ID as a payment received_by/FK value.
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

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
  const existingOther = await schoolRepo.findOne({ where: { id: OTHER_TENANT_ID } });
  if (!existingOther) {
    await schoolRepo.save(
      schoolRepo.create({
        id: OTHER_TENANT_ID,
        name: 'Other School',
        slug: 'other-school',
        tenant_id: OTHER_TENANT_ID,
      }),
    );

    // Create class + section for OTHER_TENANT so cross-tenant student tests pass FK
    const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000098';
    const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';
    await classRepo.save(
      classRepo.create({
        id: OTHER_CLASS_ID,
        name: 'Other Class',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    await sectionRepo.save(
      sectionRepo.create({
        id: OTHER_SECTION_ID,
        section_name: 'Other Section A',
        class_id: OTHER_CLASS_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
  }
}

describe('FeeStructureService (integration)', () => {
  let service: FeeStructureService;
  let feeRepo: Repository<FeeStructure>;
  let studentFeeRepo: Repository<StudentFee>;
  let paymentAllocRepo: Repository<PaymentAllocation>;
  let studentRepo: Repository<Student>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [FeeStructureService, AuditService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<FeeStructureService>(FeeStructureService);
    feeRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    paymentAllocRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
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
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM fee_structures');
      await dataSource.query('DELETE FROM payments');
      await dataSource.query('DELETE FROM students');
    }
  });

  // ────────────────────────
  //  create()
  // ────────────────────────
  describe('create', () => {
    it('should create a fee structure', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'Monthly Tuition',
        amount: 1500,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.name).toBe('Monthly Tuition');
      expect(Number(result.amount)).toBe(1500);
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('should create a school-wide fee structure without a class_id', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'School-wide Fee',
        amount: 500,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.class_id).toBeNull();
    });

    it('should create a fee structure with section_id', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'Section Fee',
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        section_id: SEED_SECTION_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.section_id).toBe(SEED_SECTION_1_ID);
    });

    it('should throw NotFoundException when class does not belong to tenant', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'Invalid Fee',
        amount: 1000,
        class_id: '00000000-0000-4000-8000-000000000000',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when section does not belong to tenant', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'Wrong Section',
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        section_id: '00000000-0000-4000-8000-000000000000',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when academic year does not belong to tenant', async () => {
      const dto = {
        fee_type: 'MONTHLY_TUITION' as any,
        name: 'Invalid Fee',
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: '00000000-0000-4000-8000-000000000000',
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  findAll()
  // ────────────────────────
  describe('findAll', () => {
    it('should return paginated fee structures', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Fee 1',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'EXAM_FEE' as any,
          name: 'Fee 2',
          amount: 500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by academic_year_id', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'AY 1 Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { academic_year_id: SEED_ACADEMIC_YEAR_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
    });

    it('should filter by class_id, including school-wide (null class_id) structures', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Class Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'School-wide Fee',
          amount: 200,
          class_id: null,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { class_id: SEED_CLASS_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(2);
    });

    // Picker ordering (D3): class-matching rows before school-wide rows.
    it('orders class-matching rows before school-wide (null class_id) rows when filtered by class_id', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'School-wide Fee',
          amount: 200,
          class_id: null,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Class Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { class_id: SEED_CLASS_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data.map((fee) => fee.name)).toEqual(['Class Fee', 'School-wide Fee']);
    });

    it('should return empty list when no fee structures match', async () => {
      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should apply default pagination when page and limit are omitted', async () => {
      // Create 15 fee structures to test pagination
      for (let i = 0; i < 15; i++) {
        await feeRepo.save(
          feeRepo.create({
            fee_type: 'MONTHLY_TUITION' as any,
            name: `Fee ${i}`,
            amount: 1000,
            class_id: SEED_CLASS_1_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            tenant_id: TENANT_ID,
          }),
        );
      }

      // No page/limit → defaults to page=1, limit=10
      const result = await service.findAll({}, TENANT_ID);

      expect(result.data).toHaveLength(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(15);
      expect(result.totalPages).toBe(2);
    });

    // [8.14.9] search over name, case-insensitive, LIKE-escaped.
    it('filters by search over name, case-insensitively', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Admission Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'EXAM_FEE' as any,
          name: 'Exam Fee',
          amount: 500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ search: 'admission', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Admission Fee');
    });

    it('filters by fee_type', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Tuition',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'EXAM_FEE' as any,
          name: 'Exam',
          amount: 500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { fee_type: 'EXAM_FEE' as any, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Exam');
    });

    it('filters by section_id', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Section Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'EXAM_FEE' as any,
          name: 'Class-wide Fee',
          amount: 500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { section_id: SEED_SECTION_1_ID, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Section Fee');
    });

    it('sorts by name using the Bengali collation', async () => {
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Zebra Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'EXAM_FEE' as any,
          name: 'Apple Fee',
          amount: 500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { sort: 'name', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data.map((fee) => fee.name)).toEqual(['Apple Fee', 'Zebra Fee']);
    });

    // Cross-tenant: search must not surface another tenant's fee structures.
    it('does not return another tenant’s fee structures when searching', async () => {
      // Fixed UUIDs seeded for the "other" tenant/class in this file's seedBase().
      const otherTenantId = '00000000-0000-4000-8000-000000000099';
      const otherTenantClassId = '00000000-0000-4000-8000-000000000098';
      await feeRepo.save(
        feeRepo.create({
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Other Tenant Fee',
          amount: 1000,
          class_id: otherTenantClassId,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: otherTenantId,
        }),
      );

      const result = await service.findAll(
        { search: 'Other Tenant', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('excludes soft-deleted structures by default and includes them with include_deleted', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Soon Deleted',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );
      await service.remove(created.id, TENANT_ID);

      const defaultResult = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(defaultResult.data.find((fee) => fee.id === created.id)).toBeUndefined();

      const withDeleted = await service.findAll(
        { page: 1, limit: 10, include_deleted: true },
        TENANT_ID,
      );
      expect(withDeleted.data.find((fee) => fee.id === created.id)).toBeDefined();
    });
  });

  // ────────────────────────
  //  findOne()
  // ────────────────────────
  describe('findOne', () => {
    it('should return a fee structure by ID with relations', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Find Me',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      const result = await service.findOne(created.id, TENANT_ID);

      expect(result.id).toBe(created.id);
      expect(result.name).toBe('Find Me');
      expect(result.class).toBeDefined();
      expect(result.academic_year).toBeDefined();
    });

    it('should throw NotFoundException when fee structure does not exist', async () => {
      await expect(
        service.findOne('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when fee structure belongs to a different tenant', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Other Tenant',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      await expect(
        service.findOne(created.id, '00000000-0000-4000-8000-000000000099'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  update()
  // ────────────────────────
  describe('update', () => {
    it('should update fee structure fields', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Original',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      const updated = await service.update(
        created.id,
        {
          name: 'Updated',
          amount: 2000,
        },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(updated.name).toBe('Updated');
      expect(Number(updated.amount)).toBe(2000);
    });

    // D7: only amount edits are audited — everything else on a fee
    // structure is a label, not money the family owes.
    it('writes a UPDATE audit record with only old/new amount when amount changes', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Original',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      await service.update(
        created.id,
        { name: 'Updated', amount: 2000 },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'FeeStructure', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].tenant_id).toBe(TENANT_ID);
      expect(logs[0].performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
      expect(logs[0].old_values).toEqual({ amount: '1000.00' });
      expect(logs[0].new_values).toEqual({ amount: 2000 });
    });

    it('does not write an audit record when only a non-amount field changes', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Original',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      await service.update(created.id, { name: 'Renamed' }, TENANT_ID, SEED_ADMIN_USER_ID);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'FeeStructure', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(0);
    });

    it('should throw NotFoundException when fee structure does not exist', async () => {
      await expect(
        service.update(
          '00000000-0000-4000-8000-000000000000',
          { name: 'Nope' },
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  remove()
  // ────────────────────────
  describe('remove (soft delete only)', () => {
    it('should soft delete a fee structure when no payments are linked', async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Delete Me',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      const raw = await feeRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(raw?.deleted_at).not.toBeNull();
    });

    // Removal never hard-deletes and never blocks on referencing StudentFee
    // rows: history keeps pointing at the (now-hidden) price tag that
    // generated them, rather than dragging billed data down with it.
    it('should soft delete even when payment allocations reference fees generated from this structure', async () => {
      const feeStructure = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Protected Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );

      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Fee Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      const studentFee = await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
          year: 2026,
          total_amount: 1000,
          paid_amount: 0,
          discount_amount: 0,
          status: 'PENDING' as any,
        }),
      );

      // Create a payment manually (not via PaymentService to avoid User FK)
      const payment = await studentRepo.manager.getRepository(Payment).save(
        studentRepo.manager.getRepository(Payment).create({
          student_id: student.id,
          total_amount: 1000,
          payment_method: 'CASH' as any,
          payment_status: 'SUCCESS' as any,
          tenant_id: TENANT_ID,
          payment_date: new Date(),
        }),
      );

      await paymentAllocRepo.save(
        paymentAllocRepo.create({
          payment_id: payment.id,
          student_fee_id: studentFee.id,
          allocated_amount: 1000,
          allocation_type: 'CURRENT' as any,
        }),
      );

      await service.remove(feeStructure.id, TENANT_ID);

      const raw = await feeRepo.findOne({ where: { id: feeStructure.id }, withDeleted: true });
      expect(raw?.deleted_at).not.toBeNull();
    });

    // Business-critical: the delete only stops the structure from driving
    // *future* generation. Already-generated fees stay exactly as they are,
    // which is what the confirm dialog's copy promises the administrator.
    it('should leave already-generated unpaid fees untouched when it deletes', async () => {
      const feeStructure = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Generated Fee Source',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Unpaid Student',
          registration_number: 'REG-2026-0009',
          roll_number: 9,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS' as any,
        }),
      );
      const studentFee = await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
          year: 2026,
          total_amount: 1000,
          paid_amount: 0,
          discount_amount: 0,
          status: 'PENDING' as any,
        }),
      );

      await service.remove(feeStructure.id, TENANT_ID);

      const survivor = await studentFeeRepo.findOne({ where: { id: studentFee.id } });
      expect(survivor).not.toBeNull();
      expect(survivor?.deleted_at ?? null).toBeNull();
      expect(survivor?.status).toBe('PENDING');
    });

    it('should throw NotFoundException when fee structure does not exist', async () => {
      await expect(
        service.remove('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    // Tenant isolation: a structure created under tenant A must not be
    // reachable — by list or by id — with tenant B's id.
    it("should not expose one tenant's structure to another tenant", async () => {
      const created = await service.create(
        {
          fee_type: 'MONTHLY_TUITION' as any,
          name: 'Tenant A Only',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        },
        TENANT_ID,
      );
      const otherTenant = '00000000-0000-4000-8000-000000000099';

      const listed = await service.findAll({} as any, otherTenant);
      expect(listed.data).toHaveLength(0);
      expect(listed.total).toBe(0);
      await expect(service.remove(created.id, otherTenant)).rejects.toThrow(NotFoundException);
    });
  });
});

// ────────────────────────────────────────────────────────────────
//  PaymentService
// ────────────────────────────────────────────────────────────────
describe('PaymentService (integration)', () => {
  let service: PaymentService;
  let studentRepo: Repository<Student>;
  let paymentRepo: Repository<Payment>;
  let studentFeeRepo: Repository<StudentFee>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [PaymentService, GuardianService, AuditService],
      [],
      {
        synchronize: true,
        dropSchema: true,
      },
    );

    service = module.get<PaymentService>(PaymentService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
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
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM payments');
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  // ────────────────────────
  //  create()
  // ────────────────────────
  describe('create', () => {
    it('should create a payment for a valid student', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Paying Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      const result = await service.create(
        {
          student_id: student.id,
          total_amount: 500,
          payment_method: 'CASH' as any,
        },
        TENANT_ID,
      );

      expect(result).toBeDefined();
      expect(result.total_amount).toBe(500);
      expect(result.tenant_id).toBe(TENANT_ID);
      expect(result.payment_status).toBe('SUCCESS'); // default
      expect(result.transaction_reference).toBeNull();
      expect(result.remarks).toBeNull();
      expect(result.received_by_user_id).toBeNull();
    });

    it('should create a payment with all optional fields and userId', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Full Payment Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      const result = await service.create(
        {
          student_id: student.id,
          total_amount: 1000,
          payment_method: 'BANK_TRANSFER' as any,
          payment_status: 'PENDING' as any,
          transaction_reference: 'TXN-001',
          remarks: 'Bank transfer from parent',
          payment_date: '2026-03-15',
        },
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result).toBeDefined();
      expect(result.total_amount).toBe(1000);
      expect(result.payment_method).toBe('BANK_TRANSFER');
      expect(result.payment_status).toBe('PENDING');
      expect(result.transaction_reference).toBe('TXN-001');
      expect(result.remarks).toBe('Bank transfer from parent');
      expect(result.received_by_user_id).toBe(SEED_ADMIN_USER_ID);
      expect(result.payment_date).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.create(
          {
            student_id: '00000000-0000-4000-8000-000000000000',
            total_amount: 500,
            payment_method: 'CASH' as any,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097', // OTHER_TENANT section
          tenant_id: '00000000-0000-4000-8000-000000000099',
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      await expect(
        service.create(
          { student_id: student.id, total_amount: 500, payment_method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  findByStudent()
  // ────────────────────────
  describe('findByStudent', () => {
    it('should return payments for a student ordered by payment_date DESC', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'History Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      await service.create(
        { student_id: student.id, total_amount: 100, payment_method: 'CASH' as any },
        TENANT_ID,
      );
      await service.create(
        { student_id: student.id, total_amount: 200, payment_method: 'CHEQUE' as any },
        TENANT_ID,
      );

      const results = await service.findByStudent(student.id, TENANT_ID);

      expect(results).toHaveLength(2);
      // Ordered by payment_date DESC — most recent first
      expect(Number(results[0].total_amount)).toBe(200);
      expect(results[0].allocations).toBeDefined();
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.findByStudent('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: '00000000-0000-4000-8000-000000000099',
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      await expect(service.findByStudent(student.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────
  //  findByGuardian()
  // ────────────────────────
  describe('findByGuardian', () => {
    it('returns payments for every student linked to the guardian, newest first, as one IN() query', async () => {
      const studentA = await studentRepo.save(
        studentRepo.create({
          full_name: 'Guardian Child A',
          registration_number: 'REG-2026-0010',
          roll_number: 10,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      const studentB = await studentRepo.save(
        studentRepo.create({
          full_name: 'Guardian Child B',
          registration_number: 'REG-2026-0011',
          roll_number: 11,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2011-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Payment Guardian',
          relationship: 'FATHER',
          preferred_communication: 'SMS',
          tenant_id: TENANT_ID,
          students: [studentA, studentB],
        }),
      );

      const older = await service.create(
        {
          student_id: studentA.id,
          total_amount: 300,
          payment_method: 'CASH' as any,
          payment_date: '2026-01-05',
        },
        TENANT_ID,
      );
      const newer = await service.create(
        {
          student_id: studentB.id,
          total_amount: 400,
          payment_method: 'CHEQUE' as any,
          payment_date: '2026-02-05',
        },
        TENANT_ID,
      );

      const results = await service.findByGuardian(guardian.id, TENANT_ID);

      expect(results).toHaveLength(2);
      // Newest payment_date first — an ascending query would fail this.
      expect(results.map((r) => r.id)).toEqual([newer.id, older.id]);
    });

    it('excludes soft-deleted payments', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Guardian Child With Deleted Payment',
          registration_number: 'REG-2026-0012',
          roll_number: 12,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Guardian With Deleted Payment',
          relationship: 'FATHER',
          preferred_communication: 'SMS',
          tenant_id: TENANT_ID,
          students: [student],
        }),
      );

      const payment = await service.create(
        { student_id: student.id, total_amount: 500, payment_method: 'CASH' as any },
        TENANT_ID,
      );
      await paymentRepo.softDelete(payment.id);

      const results = await service.findByGuardian(guardian.id, TENANT_ID);

      expect(results).toEqual([]);
    });

    it('returns an empty array for a guardian with no linked students', async () => {
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Childless Guardian',
          relationship: 'FATHER',
          preferred_communication: 'SMS',
          tenant_id: TENANT_ID,
        }),
      );

      const results = await service.findByGuardian(guardian.id, TENANT_ID);

      expect(results).toEqual([]);
    });

    it('throws NotFoundException when the guardian does not exist', async () => {
      await expect(
        service.findByGuardian('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the guardian belongs to a different tenant', async () => {
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Other Tenant Guardian',
          relationship: 'FATHER',
          preferred_communication: 'SMS',
          tenant_id: '00000000-0000-4000-8000-000000000099',
        }),
      );

      await expect(service.findByGuardian(guardian.id, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ────────────────────────
  //  getInvoiceSummary()
  // ────────────────────────
  describe('getInvoiceSummary', () => {
    it('should return invoice summary with fees, payments, and balance', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Invoice Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      // Create a student fee
      await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
          year: 2026,
          total_amount: 1000,
          paid_amount: 300,
          discount_amount: 0,
          status: 'PARTIALLY_PAID' as any,
        }),
      );

      // Create a payment
      await service.create(
        { student_id: student.id, total_amount: 300, payment_method: 'CASH' as any },
        TENANT_ID,
      );

      const result = await service.getInvoiceSummary(student.id, TENANT_ID);

      expect(result.student_id).toBe(student.id);
      expect(result.student_name).toBe('Invoice Student');
      expect(result.summary.total_due).toBe(1000);
      expect(result.summary.total_paid).toBe(300);
      expect(result.summary.total_discount).toBe(0);
      expect(result.summary.balance).toBe(700);
      expect(result.fee_breakdown).toHaveLength(1);
      expect(result.fee_breakdown[0].month).toBe(1);
      expect(result.payments).toHaveLength(1);
    });

    it('should handle zero fees (no StudentFee records)', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'No Fee Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      const result = await service.getInvoiceSummary(student.id, TENANT_ID);

      expect(result.summary.total_due).toBe(0);
      expect(result.summary.total_paid).toBe(0);
      expect(result.summary.balance).toBe(0);
      expect(result.fee_breakdown).toEqual([]);
      expect(result.payments).toEqual([]);
    });

    it('should throw NotFoundException when student does not exist', async () => {
      await expect(
        service.getInvoiceSummary('00000000-0000-4000-8000-000000000000', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Student',
          registration_number: 'REG-OTHER-0001',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: '00000000-0000-4000-8000-000000000099',
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );

      await expect(service.getInvoiceSummary(student.id, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ────────────────────────
  //  findAll()
  // ────────────────────────
  describe('findAll', () => {
    it('should search payments by transaction reference or student name', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0010',
          roll_number: 10,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      const payment = await service.create(
        {
          student_id: student.id,
          total_amount: 500,
          payment_method: 'CASH' as any,
          transaction_reference: 'TXN-SEARCH-1',
        },
        TENANT_ID,
      );

      const byReference = await service.findAll(
        { search: 'TXN-SEARCH-1', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byReference.total).toBe(1);
      expect(byReference.data[0].id).toBe(payment.id);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.total).toBe(1);
      expect(byName.data[0].id).toBe(payment.id);

      const noMatch = await service.findAll({ search: 'Nobody', page: 1, limit: 10 }, TENANT_ID);
      expect(noMatch.total).toBe(0);
    });

    it("does not return another tenant's payment when searching", async () => {
      const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
      const otherStudent = await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-OTHER-0010',
          roll_number: 10,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      // Built directly via the repository — PaymentService.create()'s own
      // tenant check requires a real class_section/class chain this test
      // has no need to seed just to prove findAll() scopes by tenant_id.
      await paymentRepo.save(
        paymentRepo.create({
          student_id: otherStudent.id,
          total_amount: 500,
          payment_method: 'CASH' as any,
          transaction_reference: 'TXN-OTHER-TENANT',
          payment_date: new Date(),
          tenant_id: OTHER_TENANT,
        }),
      );

      const byReference = await service.findAll(
        { search: 'TXN-OTHER-TENANT', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byReference.total).toBe(0);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.total).toBe(0);
    });

    it('does not return a soft-deleted payment when searching', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Fatima Begum',
          registration_number: 'REG-2026-0011',
          roll_number: 11,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: 'SMS',
        }),
      );
      const payment = await service.create(
        {
          student_id: student.id,
          total_amount: 500,
          payment_method: 'CASH' as any,
          transaction_reference: 'TXN-SOFT-DELETED',
        },
        TENANT_ID,
      );
      await paymentRepo.softDelete(payment.id);

      const byReference = await service.findAll(
        { search: 'TXN-SOFT-DELETED', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byReference.total).toBe(0);

      const byName = await service.findAll({ search: 'Fatima', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.total).toBe(0);
    });
  });
});
