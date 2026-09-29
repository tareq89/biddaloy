import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FinesService } from './fines.service';
import { FeeGenerationService, NoopDiscountResolver } from '../fee-generation.service';
import { FeeGenerationsService } from '../fee-generations.service';
import { WalletService } from '../wallet.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { ApprovalService } from '../../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { PaymentAllocationService } from '../payment-allocation.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { StorageModule } from '../../storage/storage.module';
import { FeeStructure } from '../entities/fee-structure.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeGeneration } from '../entities/fee-generation.entity';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { School } from '../../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import {
  EnrollmentStatus,
  FeeType,
  FeeStatus,
  CommunicationMedium,
  ApprovalScope,
} from '@biddaloy/shared';
import { toFamilyFine } from '../dto/family.dto';
import { FineOrigin } from './dto/fines.dto';

const JWT_SECRET = 'test-fines-secret';
const ACTOR_USER_ID = '00000000-0000-4000-8000-000000000010';
const CLASS_ID = '00000000-0000-4000-8000-000000007501';
const SECTION_ID = '00000000-0000-4000-8000-000000007502';
const TENANT_ID = SEED_TENANT_ID;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

let studentSeq = 0;

describe('FinesService (integration)', () => {
  let service: FinesService;
  let structureRepo: Repository<FeeStructure>;
  let studentFeeRepo: Repository<StudentFee>;
  let studentRepo: Repository<Student>;
  let auditRepo: Repository<AuditLog>;
  let dataSource: DataSource;
  let redis: Redis;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-FINE-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SECTION_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      ...overrides,
    });
  }

  function makeFineStructure(overrides: Partial<FeeStructure> = {}) {
    return structureRepo.create({
      fee_type: FeeType.FINE,
      name: 'Uniform Fine',
      amount: 20,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: TENANT_ID,
      ...overrides,
    });
  }

  function makeTuitionStructure(overrides: Partial<FeeStructure> = {}) {
    return structureRepo.create({
      fee_type: FeeType.MONTHLY_TUITION,
      name: 'Tuition Fee',
      amount: 1000,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: TENANT_ID,
      ...overrides,
    });
  }

  async function issueApprovalToken(jti: string): Promise<string> {
    await redis.set(`approval:${jti}`, '1', 'EX', 300);
    const jwtService = new JwtService({ secret: JWT_SECRET });
    return jwtService.signAsync(
      {
        typ: 'approval',
        sub: ACTOR_USER_ID,
        act: ACTOR_USER_ID,
        tid: TENANT_ID,
        scope: ApprovalScope.FEES_DISCOUNT,
        jti,
      },
      { expiresIn: 300 },
    );
  }

  function requestWithToken(token?: string) {
    return {
      headers: token ? { 'x-approval-token': token } : {},
      currentTenant: { id: TENANT_ID },
      user: { sub: ACTOR_USER_ID },
    };
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    const module = await createTestModule(
      ALL_ENTITIES,
      [
        FinesService,
        FeeGenerationService,
        FeeGenerationsService,
        WalletService,
        AuditService,
        NoopDiscountResolver,
        ApprovalService,
        PaymentAllocationService,
        InvoicesService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
      ],
      [StorageModule],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<FinesService>(FinesService);
    structureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    auditRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    await dataSource.getRepository(School).save(
      dataSource.getRepository(School).create({
        id: TENANT_ID,
        name: 'Fines Test School',
        slug: 'fines-test-school',
      }),
    );
    await dataSource.getRepository(AcademicYear).save(
      dataSource.getRepository(AcademicYear).create({
        id: SEED_ACADEMIC_YEAR_ID,
        name: '2026-2027',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT_ID,
      }),
    );
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: ACTOR_USER_ID,
        email: 'fines-actor@test.school',
        password_hash: 'x',
        full_name: 'Test Actor',
      }),
    );
    await dataSource.getRepository(Class).save(
      dataSource.getRepository(Class).create({
        id: CLASS_ID,
        name: 'Class One',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    await dataSource.getRepository(ClassSection).save(
      dataSource.getRepository(ClassSection).create({
        id: SECTION_ID,
        section_name: 'Section A',
        class_id: CLASS_ID,
        tenant_id: TENANT_ID,
      }),
    );
    // Cross-tenant isolation fixture — a second school sharing the same
    // academic_year_id row, same as fees.service.integration.spec.ts's
    // OTHER_TENANT_ID pattern.
    await dataSource.getRepository(School).save(
      dataSource.getRepository(School).create({
        id: OTHER_TENANT_ID,
        name: 'Other Fines School',
        slug: 'other-fines-school',
      }),
    );
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await redis.flushdb();
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM fee_generations');
    await dataSource.query('DELETE FROM fee_structures');
    await dataSource.query('DELETE FROM students');
  });

  describe('logFine', () => {
    it('logs a fine for 3 students, creating 3 bills with note and incident_date', async () => {
      const students = await studentRepo.save([makeStudent(), makeStudent(), makeStudent()]);
      const structure = await structureRepo.save(makeFineStructure());

      const result = await service.logFine(
        {
          student_ids: students.map((s) => s.id),
          fee_structure_id: structure.id,
          note: 'Uniform violation',
          incident_date: '2026-03-05',
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      expect(result.bill_ids).toHaveLength(3);
      const bills = await studentFeeRepo.find({ where: { fee_structure_id: structure.id } });
      expect(bills).toHaveLength(3);
      for (const bill of bills) {
        expect(bill.note).toBe('Uniform violation');
        expect(bill.incident_date).not.toBeNull();
        expect(Number(bill.total_amount)).toBe(20);
      }
    });

    it('logging twice for the same student and month creates occurrences 1 and 2, no approval needed', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeFineStructure());
      const dto = {
        student_ids: [student.id],
        fee_structure_id: structure.id,
        note: 'First incident',
        incident_date: '2026-03-05',
      };

      // No approval token supplied — a manual fine must never require one.
      await service.logFine(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken());
      await service.logFine(
        { ...dto, note: 'Second incident' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      const bills = await studentFeeRepo.find({
        where: { fee_structure_id: structure.id },
        order: { occurrence: 'ASC' },
      });
      expect(bills.map((b) => b.occurrence)).toEqual([1, 2]);
      expect(bills.map((b) => b.note)).toEqual(['First incident', 'Second incident']);
    });

    it('respects an amount override instead of the structure amount', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeFineStructure({ amount: 20 }));

      await service.logFine(
        {
          student_ids: [student.id],
          fee_structure_id: structure.id,
          amount: 75,
          note: 'Overridden amount',
          incident_date: '2026-03-05',
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      const [bill] = await studentFeeRepo.find({ where: { fee_structure_id: structure.id } });
      expect(Number(bill.total_amount)).toBe(75);
    });

    it('rejects a non-FINE fee structure with 400', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeTuitionStructure());

      await expect(
        service.logFine(
          {
            student_ids: [student.id],
            fee_structure_id: structure.id,
            note: 'Should fail',
            incident_date: '2026-03-05',
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('waiveFine', () => {
    async function makeFineBill(overrides: Partial<StudentFee> = {}) {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeFineStructure({ amount: 100 }));
      const bill = await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 100,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
          ...overrides,
        }),
      );
      return { student, structure, bill };
    }

    it('waives the full amount of an unpaid fine to WAIVED, leaving nothing outstanding', async () => {
      const { bill } = await makeFineBill();
      const token = await issueApprovalToken('jti-waive-full');

      const result = await service.waiveFine(
        bill.id,
        { reason: 'Goodwill waiver' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );

      expect(result.status).toBe(FeeStatus.WAIVED);
      expect(result.amount).toBe(100);
      const updated = await studentFeeRepo.findOneByOrFail({ id: bill.id });
      expect(updated.status).toBe(FeeStatus.WAIVED);
      expect(
        Number(updated.total_amount) -
          Number(updated.discount_amount) -
          Number(updated.paid_amount),
      ).toBe(0);
    });

    it('waives the rest of a half-paid fine to PAID', async () => {
      const { bill } = await makeFineBill({ paid_amount: 40, status: FeeStatus.PARTIALLY_PAID });
      const token = await issueApprovalToken('jti-waive-half-paid');

      const result = await service.waiveFine(
        bill.id,
        { reason: 'Waive the rest' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );

      expect(result.status).toBe(FeeStatus.PAID);
      expect(result.amount).toBe(60);
    });

    it('keeps a bill PENDING when a partial waive leaves 0.01 owed, then clears it', async () => {
      const { bill } = await makeFineBill();

      // Waive 99.99 of 100: one cent is still owed, so the bill must NOT be WAIVED.
      const first = await service.waiveFine(
        bill.id,
        { amount: 99.99, reason: 'Almost all' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(await issueApprovalToken('jti-waive-cent-1')),
      );
      expect(first.status).toBe(FeeStatus.PENDING);

      // Waiving the last cent clears it.
      const second = await service.waiveFine(
        bill.id,
        { reason: 'Last cent' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(await issueApprovalToken('jti-waive-cent-2')),
      );
      expect(second.status).toBe(FeeStatus.WAIVED);
      expect(second.amount).toBe(0.01);
    });

    it('rejects waiving a fully paid fine with 409', async () => {
      const { bill } = await makeFineBill({ paid_amount: 100, status: FeeStatus.PAID });
      const token = await issueApprovalToken('jti-waive-paid');

      await expect(
        service.waiveFine(
          bill.id,
          { reason: 'Nothing left' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects waiving without an approval token with 403 APPROVAL_REQUIRED', async () => {
      const { bill } = await makeFineBill();

      await expect(
        service.waiveFine(
          bill.id,
          { reason: 'No token' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(ApprovalRequiredException);

      const unchanged = await studentFeeRepo.findOneByOrFail({ id: bill.id });
      expect(unchanged.status).toBe(FeeStatus.PENDING);
    });

    it('rejects waiving a tuition (non-FINE) bill with 400', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeTuitionStructure());
      const bill = await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 1000,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      );
      const token = await issueApprovalToken('jti-waive-tuition');

      await expect(
        service.waiveFine(
          bill.id,
          { reason: 'Wrong bill type' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves an audit row with the waive reason', async () => {
      const { bill } = await makeFineBill();
      const token = await issueApprovalToken('jti-waive-audit');

      await service.waiveFine(
        bill.id,
        { reason: 'Audited reason' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );

      const logs = await auditRepo.find({
        where: { entity_id: bill.id, entity_type: 'StudentFee' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].new_values).toMatchObject({
        reason: 'Audited reason',
        approved_by_user_id: ACTOR_USER_ID,
      });
    });

    it('rejects waiving another tenant’s fine bill with 404 (tenant isolation)', async () => {
      const student = await studentRepo.save(makeStudent());
      const otherStructure = await structureRepo.save(
        makeFineStructure({ tenant_id: OTHER_TENANT_ID, amount: 100 }),
      );
      const bill = await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: otherStructure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 100,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      );
      const token = await issueApprovalToken('jti-waive-cross-tenant');

      // TENANT_ID (the caller's tenant) must not be able to touch a bill
      // whose fee_structure belongs to OTHER_TENANT_ID.
      await expect(
        service.waiveFine(
          bill.id,
          { reason: 'Should not work' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listFines', () => {
    it('returns totals matching the sum of the listed rows', async () => {
      const [s1, s2] = await studentRepo.save([makeStudent(), makeStudent()]);
      const structure = await structureRepo.save(makeFineStructure({ amount: 50 }));
      await studentFeeRepo.save([
        studentFeeRepo.create({
          student_id: s1.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 50,
          paid_amount: 20,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PARTIALLY_PAID,
        }),
        studentFeeRepo.create({
          student_id: s2.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 50,
          paid_amount: 0,
          discount_amount: 10,
          standing_discount_amount: 0,
          one_off_discount_amount: 10,
          status: FeeStatus.PENDING,
        }),
      ]);

      const result = await service.listFines({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.items).toHaveLength(2);
      const chargedSum = result.items.reduce((sum, i) => sum + i.total_amount, 0);
      const collectedSum = result.items.reduce((sum, i) => sum + i.paid_amount, 0);
      const outstandingSum = result.items.reduce(
        (sum, i) => sum + (i.total_amount - i.discount_amount - i.paid_amount),
        0,
      );
      expect(result.totals.charged).toBe(chargedSum);
      expect(result.totals.collected).toBe(collectedSum);
      expect(result.totals.outstanding).toBe(outstandingSum);
      expect(result.totals.waived).toBe(10);
    });

    it('narrows a PARENT caller to a linked child and never exposes staff fields', async () => {
      const [linked, other] = await studentRepo.save([makeStudent(), makeStudent()]);
      const structure = await structureRepo.save(makeFineStructure({ amount: 30 }));
      await studentFeeRepo.save([
        studentFeeRepo.create({
          student_id: linked.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 30,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
          approved_by_user_id: ACTOR_USER_ID,
        }),
        studentFeeRepo.create({
          student_id: other.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 30,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      ]);

      // Same restrictToStudentIds seam FeeController's `GET fees/dues` uses
      // for a family caller (FamilyAccessService.getLinkedStudentIds).
      const result = await service.listFines({ page: 1, limit: 10 }, TENANT_ID, [linked.id]);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].student_id).toBe(linked.id);

      const familyView = result.items.map(toFamilyFine);
      expect(familyView[0]).not.toHaveProperty('approved_by_user_id');
      expect(JSON.stringify(familyView)).not.toContain(ACTOR_USER_ID);
    });

    it('classifies origin as MANUAL when fine_rule_id is null', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeFineStructure());
      await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 20,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
          fine_rule_id: null,
        }),
      );

      const result = await service.listFines({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.items[0].origin).toBe(FineOrigin.MANUAL);
    });

    it('excludes another tenant’s fines from both rows and totals (tenant isolation)', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeFineStructure({ amount: 25 }));
      await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: structure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 25,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      );

      const otherStudent = await studentRepo.save(makeStudent());
      const otherStructure = await structureRepo.save(
        makeFineStructure({ tenant_id: OTHER_TENANT_ID, amount: 9999 }),
      );
      await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: otherStudent.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: otherStructure.id,
          period_start: new Date('2026-03-01'),
          occurrence: 1,
          total_amount: 9999,
          paid_amount: 0,
          discount_amount: 0,
          standing_discount_amount: 0,
          one_off_discount_amount: 0,
          status: FeeStatus.PENDING,
        }),
      );

      const result = await service.listFines({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].student_id).toBe(student.id);
      expect(result.totals.charged).toBe(25);
    });
  });
});
