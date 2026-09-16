import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  EnrollmentStatus,
  CommunicationMedium,
  FeeStatus,
  FeeType,
  PeriodType,
  PaymentMethod,
  PaymentStatus,
  PaymentAllocationType,
} from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { CollectionsReportService } from './collections-report.service';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentAllocation } from '../fees/entities/payment-allocation.entity';
import { User } from '../users/entities/user.entity';

/**
 * Integration tests for `CollectionsReportService` (16.6.2), against a
 * migrated database. Mirrors the fixture-building conventions of
 * `payments-query.service.integration.spec.ts` (same module, sibling
 * ticket) rather than reinventing them.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000067b0001';
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-0000067b0002';
const COLLECTOR_USER_ID = '00000000-0000-4000-8000-0000067b0003';

let studentSeq = 0;
let paymentSeq = 0;

describe('CollectionsReportService', () => {
  let moduleRef: TestingModule;
  let service: CollectionsReportService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let feeStructureRepo: Repository<FeeStructure>;
  let paymentRepo: Repository<Payment>;
  let paymentAllocationRepo: Repository<PaymentAllocation>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [CollectionsReportService]);
    service = moduleRef.get(CollectionsReportService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    studentFeeRepo = moduleRef.get(getRepositoryToken(StudentFee));
    feeStructureRepo = moduleRef.get(getRepositoryToken(FeeStructure));
    paymentRepo = moduleRef.get(getRepositoryToken(Payment));
    paymentAllocationRepo = moduleRef.get(getRepositoryToken(PaymentAllocation));
    userRepo = moduleRef.get(getRepositoryToken(User));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'collections-report-other-tenant', 'collections-report-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );

    await userRepo.save(
      userRepo.create({
        id: COLLECTOR_USER_ID,
        email: 'collections-report-collector@example.com',
        password_hash: 'x',
        full_name: 'Collections Report Collector',
        status: 'ACTIVE' as never,
      }),
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [COLLECTOR_USER_ID]);
    await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: TUITION_STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  async function makeStudent(tenantId = SEED_TENANT_ID): Promise<Student> {
    studentSeq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Collections Report Student ${studentSeq}`,
        registration_number: `CR-${String(studentSeq).padStart(4, '0')}`,
        roll_number: studentSeq,
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: CommunicationMedium.SMS,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: tenantId,
      } as Partial<Student>),
    );
  }

  async function makeStudentFee(
    studentId: string,
    overrides: Partial<StudentFee> = {},
  ): Promise<StudentFee> {
    return studentFeeRepo.save(
      studentFeeRepo.create({
        student_id: studentId,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        fee_structure_id: TUITION_STRUCTURE_ID,
        period_start: new Date('2026-03-01'),
        period_type: PeriodType.MONTH,
        occurrence: 1,
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 0,
        standing_discount_amount: 0,
        one_off_discount_amount: 0,
        status: FeeStatus.PENDING,
        tenant_id: SEED_TENANT_ID,
        ...overrides,
      } as Partial<StudentFee>),
    );
  }

  async function makePayment(
    studentId: string,
    tenantId = SEED_TENANT_ID,
    overrides: Partial<Payment> = {},
  ): Promise<Payment> {
    paymentSeq += 1;
    return paymentRepo.save(
      paymentRepo.create({
        student_id: studentId,
        total_amount: 1000,
        payment_method: PaymentMethod.CASH,
        payment_status: PaymentStatus.SUCCESS,
        transaction_reference: `CR-TXN-${String(paymentSeq).padStart(4, '0')}`,
        payment_date: new Date('2026-03-15T05:00:00Z'), // 11:00 Dhaka on Mar 15
        tenant_id: tenantId,
        ...overrides,
      } as Partial<Payment>),
    );
  }

  describe('getReport', () => {
    it('sums collected, reversed and net across a fixture with a reversal and discounts', async () => {
      const student = await makeStudent();
      const fee = await makeStudentFee(student.id, {
        total_amount: 1000,
        discount_amount: 200,
        standing_discount_amount: 100,
        one_off_discount_amount: 100,
      });

      const payment = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        payment_method: PaymentMethod.CASH,
        received_by_user_id: COLLECTOR_USER_ID,
        payment_date: new Date('2026-03-15T05:00:00Z'),
      });
      await paymentAllocationRepo.save(
        paymentAllocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1000,
          allocation_type: PaymentAllocationType.CURRENT,
          discount_amount: 100, // one-off portion
        }),
      );

      // Reversal: its own payment row with a POSITIVE total_amount (the
      // `payments` table's CHK_pay_total_amount constraint forbids
      // negative amounts), identified structurally via
      // reversal_of_payment_id — see the service's doc comment for why
      // this corrects the epic's stated D10 convention.
      const reversal = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        received_by_user_id: COLLECTOR_USER_ID,
        reversal_of_payment_id: payment.id,
        payment_date: new Date('2026-03-16T05:00:00Z'),
      });
      await paymentRepo.update(payment.id, { reversed_by_payment_id: reversal.id });

      const result = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(result.totals.collected).toBe(1000);
      expect(result.totals.reversed).toBe(1000);
      expect(result.totals.net).toBe(0);
      expect(result.totals.one_off_discount).toBe(100);
      // standing_discount_amount(100) * allocated_amount(1000) / total_amount(1000) = 100
      expect(result.totals.standing_discount).toBe(100);

      const cash = result.by_method.find((m) => m.payment_method === PaymentMethod.CASH);
      expect(cash?.collected).toBe(1000);
      expect(cash?.reversed).toBe(1000);
      expect(cash?.net).toBe(0);

      const collector = result.by_collector.find((c) => c.user_id === COLLECTOR_USER_ID);
      expect(collector?.count).toBe(2);
      expect(collector?.net).toBe(0);

      const feeType = result.by_fee_type.find((f) => f.fee_type === FeeType.MONTHLY_TUITION);
      expect(feeType?.collected).toBe(1000);
      expect(feeType?.discount).toBe(200);

      // Dhaka is UTC+6: 2026-03-15T05:00:00Z is 2026-03-15 11:00 Dhaka, and
      // 2026-03-16T05:00:00Z is 2026-03-16 11:00 Dhaka — two distinct days.
      expect(result.by_day.map((d) => d.date)).toEqual(['2026-03-15', '2026-03-16']);
    });

    it('applies the Dhaka day boundary at the edges of the range, not UTC midnight', async () => {
      const student = await makeStudent();
      // 2026-03-01T00:30:00Z is still 2026-02-28 in Dhaka (UTC+6) — should
      // fall OUTSIDE a `from: 2026-03-01` filter.
      await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-03-01T00:30:00Z'),
      });
      // 2026-03-01T18:00:00Z is 2026-03-02 00:00 Dhaka — should be INSIDE.
      const inside = await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-03-01T18:00:00Z'),
      });

      const result = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-01',
        to: '2026-03-01',
      });

      expect(result.totals.collected).toBe(Number(inside.total_amount));
    });

    it('is tenant-isolated', async () => {
      const student = await makeStudent();
      const other = await makeStudent(OTHER_TENANT_ID);
      await makePayment(student.id, SEED_TENANT_ID, { total_amount: 500 });
      await makePayment(other.id, OTHER_TENANT_ID, { total_amount: 9999 });

      const result = await service.getReport(SEED_TENANT_ID, {
        from: '2026-01-01',
        to: '2026-12-31',
      });

      expect(result.totals.collected).toBe(500);
    });
  });

  describe('getCsvRows', () => {
    it('returns one row per payment, flagging reversals', async () => {
      const student = await makeStudent();
      const payment = await makePayment(student.id, SEED_TENANT_ID, { total_amount: 700 });
      const reversal = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 700,
        reversal_of_payment_id: payment.id,
        payment_date: new Date('2026-03-17T05:00:00Z'),
      });
      await paymentRepo.update(payment.id, { reversed_by_payment_id: reversal.id });

      const rows = await service.getCsvRows(SEED_TENANT_ID, {
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(rows).toHaveLength(2);
      const reversalRow = rows.find((r) => r.is_reversal);
      expect(reversalRow?.amount).toBe(700);
      const originalRow = rows.find((r) => !r.is_reversal);
      expect(originalRow?.amount).toBe(700);
    });
  });
});
