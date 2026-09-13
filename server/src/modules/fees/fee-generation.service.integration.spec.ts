import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FeeGenerationService, NoopDiscountResolver } from './fee-generation.service';
import { FeeGenerationsService } from './fee-generations.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../common/errors/approval-required.exception';
import { PaymentAllocationService } from './payment-allocation.service';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { School } from '../schools/entities/school.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import {
  EnrollmentStatus,
  FeeType,
  FeeStatus,
  CommunicationMedium,
  PeriodType,
  DuplicateStrategy,
  ApprovalScope,
  PaymentMethod,
  PaymentAllocationType,
} from '@biddaloy/shared';

const JWT_SECRET = 'test-fee-generation-secret';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000098';
const ACTOR_USER_ID = '00000000-0000-4000-8000-000000000010';
const CLASS_ID = '00000000-0000-4000-8000-000000006501';
const SECTION_ID = '00000000-0000-4000-8000-000000006502';
const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000006503';
const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000006504';

let studentSeq = 0;
let structureSeq = 0;

describe('FeeGenerationService (integration)', () => {
  let service: FeeGenerationService;
  let structureRepo: Repository<FeeStructure>;
  let studentFeeRepo: Repository<StudentFee>;
  let feeGenerationRepo: Repository<FeeGeneration>;
  let studentRepo: Repository<Student>;
  let walletRepo: Repository<StudentWallet>;
  let paymentAllocationService: PaymentAllocationService;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-GENV2-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SECTION_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      ...overrides,
    });
  }

  function makeStructure(overrides: Partial<FeeStructure> = {}) {
    structureSeq += 1;
    return structureRepo.create({
      fee_type: FeeType.MONTHLY_TUITION,
      name: `Tuition ${structureSeq}`,
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
        scope: ApprovalScope.FEES_DUPLICATE_OVERRIDE,
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
        FeeGenerationService,
        FeeGenerationsService,
        WalletService,
        AuditService,
        NoopDiscountResolver,
        ApprovalService,
        PaymentAllocationService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<FeeGenerationService>(FeeGenerationService);
    structureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    feeGenerationRepo = module.get<Repository<FeeGeneration>>(getRepositoryToken(FeeGeneration));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    walletRepo = module.get<Repository<StudentWallet>>(getRepositoryToken(StudentWallet));
    paymentAllocationService = module.get<PaymentAllocationService>(PaymentAllocationService);
    dataSource = module.get(DataSource);

    await dataSource.getRepository(School).save(
      dataSource.getRepository(School).create({
        id: TENANT_ID,
        name: 'Fee Generation V2 Test School',
        slug: 'fee-generation-v2-test-school',
      }),
    );
    await dataSource.getRepository(School).save(
      dataSource.getRepository(School).create({
        id: OTHER_TENANT_ID,
        name: 'Other School',
        slug: 'fee-generation-v2-other-school',
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
        email: 'fee-generation-v2-actor@test.school',
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
    await dataSource.getRepository(Class).save(
      dataSource.getRepository(Class).create({
        id: OTHER_CLASS_ID,
        name: 'Other Class',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    await dataSource.getRepository(ClassSection).save(
      dataSource.getRepository(ClassSection).create({
        id: OTHER_SECTION_ID,
        section_name: 'Other Section',
        class_id: OTHER_CLASS_ID,
        tenant_id: OTHER_TENANT_ID,
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
    await dataSource.query('DELETE FROM wallet_transactions');
    await dataSource.query('DELETE FROM student_wallets');
    await dataSource.query('DELETE FROM payment_allocations');
    await dataSource.query('DELETE FROM invoices');
    await dataSource.query('DELETE FROM payments');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM fee_generations');
    await dataSource.query('DELETE FROM fee_structures');
    await dataSource.query('DELETE FROM students');
  });

  it('generates 3 students x 2 fee structures = 6 bills, one batch, correct counters', async () => {
    const students = await studentRepo.save([makeStudent(), makeStudent(), makeStudent()]);
    const structures = await structureRepo.save([makeStructure(), makeStructure()]);

    const result = await service.generate(
      {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        period_start: '2026-03-01',
        period_type: PeriodType.MONTH,
        student_ids: students.map((s) => s.id),
        fee_structure_ids: structures.map((s) => s.id),
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    expect(result.generated_count).toBe(6);
    expect(result.skipped_count).toBe(0);
    expect(result.removed_count).toBe(0);
    expect(result.student_count).toBe(3);

    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(6);

    const batch = await feeGenerationRepo.findOneOrFail({
      where: { id: result.fee_generation_id },
    });
    expect(batch.generated_count).toBe(6);
    expect(batch.student_count).toBe(3);
  });

  describe('period normalisation', () => {
    it('rejects a MONTH period_start that is not the 1st of a month', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await expect(
        service.generate(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            period_start: '2026-03-15',
            period_type: PeriodType.MONTH,
            student_ids: [student.id],
            fee_structure_ids: [structure.id],
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a WEEK period_start that is not a Monday', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await expect(
        service.generate(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            period_start: '2026-03-04', // a Wednesday
            period_type: PeriodType.WEEK,
            student_ids: [student.id],
            fee_structure_ids: [structure.id],
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a correctly-aligned MONTH and WEEK period_start', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      const monthResult = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-04-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(monthResult.generated_count).toBe(1);

      // 2026-03-02 is a Monday.
      const weekResult = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-03-02',
          period_type: PeriodType.WEEK,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(weekResult.generated_count).toBe(1);
    });
  });

  describe('duplicate strategies', () => {
    it('SKIP counts existing pairs as skipped and does not touch them', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      const first = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-05-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(first.generated_count).toBe(1);

      const second = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-05-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
          duplicate_strategy: DuplicateStrategy.SKIP,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(second.generated_count).toBe(0);
      expect(second.skipped_count).toBe(1);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
    });

    it('REMOVE_OLDER on an unpaid bill needs no approval: old removed, new inserted', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      const first = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-06-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      const oldBillId = (await studentFeeRepo.find())[0].id;
      expect(first.generated_count).toBe(1);

      const second = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-06-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
          duplicate_strategy: DuplicateStrategy.REMOVE_OLDER,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(), // no token supplied — must not be needed
      );
      expect(second.generated_count).toBe(1);
      expect(second.removed_count).toBe(1);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].id).not.toBe(oldBillId);
    });

    it('REMOVE_OLDER on a paid bill without an approval token throws APPROVAL_REQUIRED and writes nothing', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-07-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      const bill = (await studentFeeRepo.find())[0];
      await studentFeeRepo.update(bill.id, { paid_amount: 500, status: FeeStatus.PARTIALLY_PAID });

      await expect(
        service.generate(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            period_start: '2026-07-01',
            period_type: PeriodType.MONTH,
            student_ids: [student.id],
            fee_structure_ids: [structure.id],
            duplicate_strategy: DuplicateStrategy.REMOVE_OLDER,
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(), // no token
        ),
      ).rejects.toThrow(ApprovalRequiredException);

      // Nothing was written: still exactly the one original (paid) bill,
      // and no second batch was created.
      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].id).toBe(bill.id);
      expect(Number(bills[0].paid_amount)).toBe(500);
      const batches = await feeGenerationRepo.find();
      expect(batches).toHaveLength(1);
    });

    it('REMOVE_OLDER on a bill with a real payment allocation soft-deletes it and creates a new one, keeping the allocation intact', async () => {
      // Regression for the money-tier review finding: student_fees now has
      // a soft-delete column (#651) and the unique index on
      // (student_id, fee_structure_id, period_start, occurrence) is
      // partial (`WHERE deleted_at IS NULL`), so REMOVE_OLDER over an
      // allocated bill no longer needs a hard-delete pre-check — it
      // soft-deletes the old bill (consuming the REMOVE_OLDER_PAID
      // approval), the allocation keeps pointing at the now-deleted row for
      // history, and a fresh bill is created at occurrence 1.
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-08-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      const bill = (await studentFeeRepo.find())[0];

      // Record a real payment against this bill via the same service
      // families/staff use, so the allocation row exists exactly as it
      // would in production.
      const payment = await paymentAllocationService.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: Number(bill.total_amount),
          payment_method: PaymentMethod.CASH,
          allocations: [
            {
              student_fee_id: bill.id,
              allocated_amount: Number(bill.total_amount),
              allocation_type: PaymentAllocationType.DUE,
            },
          ],
        },
        TENANT_ID,
        ACTOR_USER_ID,
      );

      const token = await issueApprovalToken('jti-remove-older-allocated');
      const result = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-08-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
          duplicate_strategy: DuplicateStrategy.REMOVE_OLDER,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );
      expect(result.generated_count).toBe(1);
      expect(result.removed_count).toBe(1);

      const oldBill = await studentFeeRepo.findOne({ where: { id: bill.id }, withDeleted: true });
      expect(oldBill).not.toBeNull();
      expect(oldBill!.deleted_at).not.toBeNull();

      const allocation = await dataSource.getRepository(PaymentAllocation).findOne({
        where: { payment_id: payment.id, student_fee_id: bill.id },
      });
      expect(allocation).not.toBeNull();

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].id).not.toBe(bill.id);
      expect(bills[0].occurrence).toBe(1);
    });

    it('recreates a soft-deleted bill under SKIP once the old one is removed (partial unique index)', async () => {
      // Proves the partial unique index actually lets a same-key row
      // through once the old one is soft-deleted — with a plain (non
      // partial) unique constraint this insert would silently no-op via
      // `.orIgnore()` and generated_count would stay 0.
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-09-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      const bill = (await studentFeeRepo.find())[0];
      await studentFeeRepo.softDelete(bill.id);

      const result = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-09-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
          duplicate_strategy: DuplicateStrategy.SKIP,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      expect(result.generated_count).toBe(1);
      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].id).not.toBe(bill.id);
      expect(bills[0].occurrence).toBe(1);
    });

    it('CREATE_ANYWAY with a valid approval token sets occurrence = 2', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-08-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      const token = await issueApprovalToken('jti-create-anyway');
      const result = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-08-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
          duplicate_strategy: DuplicateStrategy.CREATE_ANYWAY,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );
      expect(result.generated_count).toBe(1);

      const bills = await studentFeeRepo.find({ order: { occurrence: 'ASC' } });
      expect(bills).toHaveLength(2);
      expect(bills[0].occurrence).toBe(1);
      expect(bills[1].occurrence).toBe(2);
    });

    it('CREATE_ANYWAY without a token throws APPROVAL_REQUIRED and writes nothing', async () => {
      const student = await studentRepo.save(makeStudent());
      const structure = await structureRepo.save(makeStructure());

      await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-09-01',
          period_type: PeriodType.MONTH,
          student_ids: [student.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      await expect(
        service.generate(
          {
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            period_start: '2026-09-01',
            period_type: PeriodType.MONTH,
            student_ids: [student.id],
            fee_structure_ids: [structure.id],
            duplicate_strategy: DuplicateStrategy.CREATE_ANYWAY,
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(ApprovalRequiredException);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
    });
  });

  it('wallet auto-apply: 500 balance fully pays a 300 bill and partially pays a 400 bill', async () => {
    const student = await studentRepo.save(makeStudent());
    const structures = await structureRepo.save([
      makeStructure({ name: 'Tuition', amount: 300 }),
      makeStructure({ name: 'Library', amount: 400, fee_type: FeeType.LIBRARY_FEE }),
    ]);
    await walletRepo.save(
      walletRepo.create({ student_id: student.id, tenant_id: TENANT_ID, balance: 500 }),
    );

    await service.generate(
      {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        period_start: '2026-10-01',
        period_type: PeriodType.MONTH,
        student_ids: [student.id],
        fee_structure_ids: structures.map((s) => s.id),
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const bills = await studentFeeRepo.find({ order: { total_amount: 'ASC' } });
    expect(bills).toHaveLength(2);
    const [smaller, larger] = bills;
    expect(Number(smaller.total_amount)).toBe(300);
    expect(Number(smaller.paid_amount)).toBe(300);
    expect(smaller.status).toBe(FeeStatus.PAID);
    expect(Number(larger.total_amount)).toBe(400);
    expect(Number(larger.paid_amount)).toBe(200);
    expect(larger.status).toBe(FeeStatus.PARTIALLY_PAID);

    const wallet = await walletRepo.findOne({ where: { student_id: student.id } });
    expect(Number(wallet!.balance)).toBe(0);
  });

  describe('inactive students', () => {
    it('are skipped from generation and listed, unless include_inactive is true', async () => {
      const active = await studentRepo.save(makeStudent());
      const inactive = await studentRepo.save(
        makeStudent({ enrollment_status: EnrollmentStatus.INACTIVE }),
      );
      const structure = await structureRepo.save(makeStructure());

      const result = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-11-01',
          period_type: PeriodType.MONTH,
          student_ids: [active.id, inactive.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(result.generated_count).toBe(1);
      expect(result.inactive_skipped.map((s) => s.id)).toEqual([inactive.id]);

      const withInactive = await service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-12-01',
          period_type: PeriodType.MONTH,
          student_ids: [active.id, inactive.id],
          fee_structure_ids: [structure.id],
          include_inactive: true,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      expect(withInactive.generated_count).toBe(2);
    });
  });

  it('a student_id belonging to another tenant is a 404, and nothing is written', async () => {
    const validStudent = await studentRepo.save(makeStudent());
    const otherTenantStudent = await studentRepo.save(
      makeStudent({ tenant_id: OTHER_TENANT_ID, class_section_id: OTHER_SECTION_ID }),
    );
    const structure = await structureRepo.save(makeStructure());

    await expect(
      service.generate(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-03-01',
          period_type: PeriodType.MONTH,
          student_ids: [validStudent.id, otherTenantStudent.id],
          fee_structure_ids: [structure.id],
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(NotFoundException);

    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(0);
    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(0);
  });
});
