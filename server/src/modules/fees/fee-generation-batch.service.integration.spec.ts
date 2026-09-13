import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FeeGenerationBatchService } from './fee-generation-batch.service';
import { FeeGenerationsService } from './fee-generations.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../common/errors/approval-required.exception';
import { FeeStructure } from './entities/fee-structure.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { Payment } from './entities/payment.entity';
import { Student } from '../students/entities/student.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
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
import {
  PeriodType,
  FeeType,
  FeeStatus,
  FeeGenerationSource,
  DuplicateStrategy,
  ApprovalScope,
  WalletTransactionKind,
  PaymentMethod,
  PaymentAllocationType,
} from '@biddaloy/shared';

/**
 * Integration tests for FeeGenerationBatchService (16.3.2) — the four
 * batch-fixing mutations: edit period, delete batch, remove one student,
 * remove only the uncollected bills.
 *
 * Runs against a real PostgreSQL + Redis (the approval token store), same
 * as `fee-generation.service.integration.spec.ts`'s own setup.
 */

const JWT_SECRET = 'test-fee-generation-batch-secret';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000006901';
const ACTOR_USER_ID = SEED_ADMIN_USER_ID;

let studentSeq = 0;

describe('FeeGenerationBatchService (integration)', () => {
  let service: FeeGenerationBatchService;
  let generationsService: FeeGenerationsService;
  let studentFeeRepo: Repository<StudentFee>;
  let generationRepo: Repository<FeeGeneration>;
  let studentRepo: Repository<Student>;
  let walletRepo: Repository<StudentWallet>;
  let walletTxRepo: Repository<WalletTransaction>;
  let paymentAllocationRepo: Repository<PaymentAllocation>;
  let paymentRepo: Repository<Payment>;
  let auditLogRepo: Repository<AuditLog>;
  let feeStructureRepo: Repository<FeeStructure>;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;
  let feeStructureId: string;

  function makeStudent() {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-FGBS-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
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
        scope: ApprovalScope.FEES_EDIT_PAID,
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

  async function createBatch(overrides: Partial<{ period_start: string; due_date: string }> = {}) {
    return dataSource.transaction((manager) =>
      generationsService.create(
        {
          tenant_id: TENANT_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: overrides.period_start ?? '2026-07-01',
          period_type: PeriodType.MONTH,
          due_date: overrides.due_date ?? '2026-07-10',
          source: FeeGenerationSource.MANUAL,
          generated_by_user_id: ACTOR_USER_ID,
          duplicate_strategy: DuplicateStrategy.SKIP,
          notify_families: false,
          structures: [
            { id: feeStructureId, name: 'Tuition', fee_type: 'MONTHLY_TUITION', amount: 1000 },
          ],
          student_count: 0,
          generated_count: 0,
          skipped_count: 0,
          removed_count: 0,
        },
        manager,
      ),
    );
  }

  async function addBill(
    generationId: string,
    studentId: string,
    overrides: Partial<{
      period_start: string;
      paid_amount: number;
      status: FeeStatus;
      occurrence: number;
    }> = {},
  ) {
    const bill = studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      fee_structure_id: feeStructureId,
      fee_generation_id: generationId,
      period_start: new Date(overrides.period_start ?? '2026-07-01'),
      period_type: PeriodType.MONTH,
      occurrence: overrides.occurrence ?? 1,
      total_amount: 1000,
      paid_amount: overrides.paid_amount ?? 0,
      discount_amount: 0,
      status: overrides.status ?? FeeStatus.PENDING,
      due_date: new Date('2026-07-10'),
    });
    return studentFeeRepo.save(bill);
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    // No `{ synchronize: true, dropSchema: true }`: this ticket relies on
    // `student_fees.deleted_at`, added by a real migration
    // (`1789800006000-AddStudentFeesDeletedAt`) rather than being declared
    // fresh here — connecting to the already-migrated test database (see
    // `test/global-setup.ts`) is what makes that column exist at all.
    const module = await createTestModule(ALL_ENTITIES, [
      FeeGenerationBatchService,
      FeeGenerationsService,
      WalletService,
      AuditService,
      ApprovalService,
      JwtService,
      { provide: 'APPROVAL_REDIS', useValue: redis },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
      },
    ]);

    service = module.get<FeeGenerationBatchService>(FeeGenerationBatchService);
    generationsService = module.get<FeeGenerationsService>(FeeGenerationsService);
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    generationRepo = module.get<Repository<FeeGeneration>>(getRepositoryToken(FeeGeneration));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    walletRepo = module.get<Repository<StudentWallet>>(getRepositoryToken(StudentWallet));
    walletTxRepo = module.get<Repository<WalletTransaction>>(getRepositoryToken(WalletTransaction));
    paymentAllocationRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    feeStructureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    dataSource = module.get(DataSource);

    await dataSource.query('DELETE FROM schools');
    const schoolRepo = dataSource.getRepository(School);
    const userRepo = dataSource.getRepository(User);
    const ayRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_ID, name: 'Test School', slug: 'test-fgbs' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-fgbs' }),
    );
    await userRepo.save(
      userRepo.create({
        id: ACTOR_USER_ID,
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
        tenant_id: TENANT_ID,
      }),
    );
    await classRepo.save(
      classRepo.create({
        id: SEED_CLASS_1_ID,
        name: 'Class One',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    await sectionRepo.save(
      sectionRepo.create({
        id: SEED_SECTION_1_ID,
        section_name: 'Section A',
        class_id: SEED_CLASS_1_ID,
        tenant_id: TENANT_ID,
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
    redis.disconnect();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM wallet_transactions');
    await dataSource.query('DELETE FROM student_wallets');
    await dataSource.query('DELETE FROM payment_allocations');
    await dataSource.query('DELETE FROM payments');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM fee_generations');
    await dataSource.query('DELETE FROM students');

    feeStructureId = (
      await feeStructureRepo.save(
        feeStructureRepo.create({
          name: 'Tuition',
          fee_type: FeeType.MONTHLY_TUITION,
          amount: '1000.00',
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      )
    ).id;
  });

  describe('removeUncollected', () => {
    it('soft-deletes only bills with paid_amount = 0, leaving the paid one', async () => {
      const batch = await createBatch();
      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      const unpaid = await addBill(batch.id, s1.id);
      const paid = await addBill(batch.id, s2.id, { paid_amount: 1000, status: FeeStatus.PAID });

      const result = await service.removeUncollected(batch.id, TENANT_ID, ACTOR_USER_ID);
      expect(result.removed_count).toBe(1);

      const remainingUnpaid = await studentFeeRepo.findOne({ where: { id: unpaid.id } });
      const remainingPaid = await studentFeeRepo.findOne({ where: { id: paid.id } });
      expect(remainingUnpaid).toBeNull(); // excluded by default soft-delete scope
      expect(remainingPaid).toBeDefined();

      const withDeleted = await studentFeeRepo.findOne({
        where: { id: unpaid.id },
        withDeleted: true,
      });
      expect(withDeleted!.deleted_at).not.toBeNull();
    });

    it('leaves a bill with a payment allocation alone even if paid_amount is 0', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      const bill = await addBill(batch.id, student.id);

      const payment = await paymentRepo.save(
        paymentRepo.create({
          tenant_id: TENANT_ID,
          student_id: student.id,
          total_amount: 500,
          payment_method: PaymentMethod.CASH,
          received_by_user_id: ACTOR_USER_ID,
          payment_date: new Date(),
        }),
      );
      await paymentAllocationRepo.save(
        paymentAllocationRepo.create({
          payment_id: payment.id,
          student_fee_id: bill.id,
          allocated_amount: 500,
          allocation_type: PaymentAllocationType.CURRENT,
        }),
      );

      const result = await service.removeUncollected(batch.id, TENANT_ID, ACTOR_USER_ID);
      expect(result.removed_count).toBe(0);

      const stillThere = await studentFeeRepo.findOne({ where: { id: bill.id } });
      expect(stillThere).toBeDefined();
    });
  });

  describe('deleteBatch', () => {
    it('soft-deletes an uncollected batch and all its bills with no approval', async () => {
      const batch = await createBatch();
      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      await addBill(batch.id, s1.id);
      await addBill(batch.id, s2.id);

      await service.deleteBatch(batch.id, TENANT_ID, ACTOR_USER_ID, requestWithToken());

      const batchAfter = await generationRepo.findOne({ where: { id: batch.id } });
      expect(batchAfter).toBeNull();

      const bills = await studentFeeRepo.find({ where: { fee_generation_id: batch.id } });
      expect(bills).toHaveLength(0);
    });

    it('throws APPROVAL_REQUIRED and writes nothing when one bill is paid and no token is sent', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      await addBill(batch.id, student.id, { paid_amount: 1000, status: FeeStatus.PAID });

      await expect(
        service.deleteBatch(batch.id, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ).rejects.toThrow(ApprovalRequiredException);

      const batchAfter = await generationRepo.findOne({ where: { id: batch.id } });
      expect(batchAfter).toBeDefined();
      expect(batchAfter!.deleted_at).toBeNull();

      const bills = await studentFeeRepo.find({ where: { fee_generation_id: batch.id } });
      expect(bills).toHaveLength(1);
    });

    it('with a valid token, deletes the batch and records the approver on the audit row', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      await addBill(batch.id, student.id, { paid_amount: 1000, status: FeeStatus.PAID });

      const jti = `jti-delete-${Date.now()}`;
      const token = await issueApprovalToken(jti);

      await service.deleteBatch(batch.id, TENANT_ID, ACTOR_USER_ID, requestWithToken(token));

      const batchAfter = await generationRepo.findOne({ where: { id: batch.id } });
      expect(batchAfter).toBeNull();

      const auditRow = await auditLogRepo.findOne({
        where: { entity_type: 'FeeGeneration', entity_id: batch.id },
        order: { created_at: 'DESC' },
      });
      expect(auditRow).toBeDefined();
      expect((auditRow!.new_values as any).approved_by_user_id).toBe(ACTOR_USER_ID);
      expect((auditRow!.new_values as any).approval_scope).toBe(ApprovalScope.FEES_EDIT_PAID);
    });

    it('reverses a generation-time wallet auto-apply debit back to the wallet on removal', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      const bill = await addBill(batch.id, student.id, {
        paid_amount: 400,
        status: FeeStatus.PARTIALLY_PAID,
      });

      const wallet = await walletRepo.save(
        walletRepo.create({ tenant_id: TENANT_ID, student_id: student.id, balance: 0 }),
      );
      const debitTx = await walletTxRepo.save(
        walletTxRepo.create({
          tenant_id: TENANT_ID,
          wallet_id: wallet.id,
          amount: -400,
          kind: WalletTransactionKind.DEBIT_GENERATION,
          student_fee_id: bill.id,
        }),
      );

      const jti = `jti-reversal-${Date.now()}`;
      const token = await issueApprovalToken(jti);
      await service.deleteBatch(batch.id, TENANT_ID, ACTOR_USER_ID, requestWithToken(token));

      const walletAfter = await walletRepo.findOne({ where: { id: wallet.id } });
      expect(Number(walletAfter!.balance)).toBe(400);

      const reversal = await walletTxRepo.findOne({
        where: { reversal_of_id: debitTx.id },
      });
      expect(reversal).toBeDefined();
      expect(Number(reversal!.amount)).toBe(400);
      expect(reversal!.kind).toBe(WalletTransactionKind.REVERSAL);
    });

    it('is tenant-isolated: a batch from another tenant 404s', async () => {
      await expect(
        service.deleteBatch(
          '00000000-0000-4000-8000-000000009999',
          OTHER_TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeStudent', () => {
    it("soft-deletes just that student's bills, leaving the other student's", async () => {
      const batch = await createBatch();
      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      const billS1 = await addBill(batch.id, s1.id);
      const billS2 = await addBill(batch.id, s2.id);

      await service.removeStudent(batch.id, s1.id, TENANT_ID, ACTOR_USER_ID, requestWithToken());

      const remainingS1 = await studentFeeRepo.findOne({ where: { id: billS1.id } });
      const remainingS2 = await studentFeeRepo.findOne({ where: { id: billS2.id } });
      expect(remainingS1).toBeNull();
      expect(remainingS2).toBeDefined();
    });
  });

  describe('patch', () => {
    it('changes period_start/due_date on the batch and every one of its bills', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      const bill = await addBill(batch.id, student.id);

      await service.patch(
        batch.id,
        { period_start: '2026-08-01', due_date: '2026-08-10' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

      const batchAfter = await generationRepo.findOne({ where: { id: batch.id } });
      const billAfter = await studentFeeRepo.findOne({ where: { id: bill.id } });
      expect(new Date(batchAfter!.period_start).toISOString().slice(0, 10)).toBe('2026-08-01');
      expect(new Date(billAfter!.period_start).toISOString().slice(0, 10)).toBe('2026-08-01');
      expect(new Date(billAfter!.due_date!).toISOString().slice(0, 10)).toBe('2026-08-10');
    });

    it('409s with the colliding students when the new period_start collides with an existing bill', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      const bill = await addBill(batch.id, student.id, { period_start: '2026-07-01' });
      // A bill for the same student/structure/occurrence already exists in
      // the target period, created outside this batch (e.g. from a
      // different generation run) — the collision this PATCH must catch.
      await studentFeeRepo.save(
        studentFeeRepo.create({
          student_id: student.id,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          fee_structure_id: feeStructureId,
          fee_generation_id: null,
          period_start: new Date('2026-08-01'),
          period_type: PeriodType.MONTH,
          occurrence: 1,
          total_amount: 1000,
          paid_amount: 0,
          discount_amount: 0,
          status: FeeStatus.PENDING,
          due_date: new Date('2026-08-10'),
        }),
      );

      await expect(
        service.patch(
          batch.id,
          { period_start: '2026-08-01' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(ConflictException);

      // Nothing changed — the conflict check runs before any write.
      const billAfter = await studentFeeRepo.findOne({ where: { id: bill.id } });
      expect(new Date(billAfter!.period_start).toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    it('requires approval when a bill in the batch already has money against it', async () => {
      const batch = await createBatch();
      const student = await studentRepo.save(makeStudent());
      await addBill(batch.id, student.id, { paid_amount: 1000, status: FeeStatus.PAID });

      await expect(
        service.patch(
          batch.id,
          { due_date: '2026-08-15' },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(ApprovalRequiredException);
    });
  });
});
