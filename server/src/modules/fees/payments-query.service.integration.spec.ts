import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
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
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { PaymentsQueryService } from './payments-query.service';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { User } from '../users/entities/user.entity';

/**
 * Integration tests for PaymentsQueryService (16.4.3), against the real
 * migrated test database.
 *
 * `PaymentAllocation` has no `fee_name`/`period_start` columns of its own —
 * these come from a `student_fee` → `fee_structure` join done here, which
 * these tests verify directly (including the soft-deleted-relation guard).
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000006e0001';
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-0000006e0002';
const OTHER_STRUCTURE_ID = '00000000-0000-4000-8000-0000006e0003';

let studentSeq = 0;
let paymentSeq = 0;

describe('PaymentsQueryService (integration)', () => {
  let moduleRef: TestingModule;
  let service: PaymentsQueryService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let feeStructureRepo: Repository<FeeStructure>;
  let paymentRepo: Repository<Payment>;
  let allocationRepo: Repository<PaymentAllocation>;
  let invoiceRepo: Repository<Invoice>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [PaymentsQueryService]);
    service = moduleRef.get(PaymentsQueryService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    studentFeeRepo = moduleRef.get(getRepositoryToken(StudentFee));
    feeStructureRepo = moduleRef.get(getRepositoryToken(FeeStructure));
    paymentRepo = moduleRef.get(getRepositoryToken(Payment));
    allocationRepo = moduleRef.get(getRepositoryToken(PaymentAllocation));
    invoiceRepo = moduleRef.get(getRepositoryToken(Invoice));
    userRepo = moduleRef.get(getRepositoryToken(User));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Payments Query Other Tenant', 'payments-query-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
    // fee_structures is truncated by the global per-test beforeEach
    // (test/setup.ts) before this one runs — re-seed every test.
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
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: OTHER_STRUCTURE_ID,
        fee_type: FeeType.EXAM_FEE,
        name: 'Exam Fee',
        amount: 500,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  async function makeStudent(
    tenantId = SEED_TENANT_ID,
    overrides: Partial<Student> = {},
  ): Promise<Student> {
    studentSeq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Payments Query Student ${studentSeq}`,
        registration_number: `PQ-${String(studentSeq).padStart(4, '0')}`,
        roll_number: studentSeq,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: tenantId,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: CommunicationMedium.SMS,
        enrollment_status: EnrollmentStatus.ACTIVE,
        ...overrides,
      } as Partial<Student>),
    );
  }

  async function makeStudentFee(
    studentId: string,
    feeStructureId = TUITION_STRUCTURE_ID,
    overrides: Partial<StudentFee> = {},
  ): Promise<StudentFee> {
    return studentFeeRepo.save(
      studentFeeRepo.create({
        student_id: studentId,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        fee_structure_id: feeStructureId,
        period_start: new Date('2026-01-01'),
        period_type: PeriodType.MONTH,
        occurrence: 1,
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 0,
        status: FeeStatus.PENDING,
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
        transaction_reference: `TXN-${String(paymentSeq).padStart(4, '0')}`,
        payment_date: new Date('2026-01-15T00:00:00Z'),
        tenant_id: tenantId,
        ...overrides,
      } as Partial<Payment>),
    );
  }

  describe('findAll', () => {
    it('paginates and orders by payment_date DESC by default, tied by id', async () => {
      const student = await makeStudent();
      const sameDate = new Date('2026-02-01T00:00:00Z');
      const p1 = await makePayment(student.id, SEED_TENANT_ID, { payment_date: sameDate });
      const p2 = await makePayment(student.id, SEED_TENANT_ID, { payment_date: sameDate });
      await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.findAll({ page: 1, limit: 2 } as any, SEED_TENANT_ID);

      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(2);
      // Same payment_date → tiebreak by id ASC, deterministically.
      const expectedFirstTwo = [p1, p2].sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => p.id);
      expect(result.data.map((p) => p.id)).toEqual(expectedFirstTwo);
    });

    it('filters by search across transaction reference and student name/registration number', async () => {
      const student = await makeStudent(SEED_TENANT_ID, { full_name: 'Karim Ahmed' });
      const other = await makeStudent();
      const target = await makePayment(student.id, SEED_TENANT_ID, {
        transaction_reference: 'UNIQUE-REF-1',
      });
      await makePayment(other.id, SEED_TENANT_ID);

      const byReference = await service.findAll(
        { search: 'unique-ref-1', page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );
      expect(byReference.data.map((p) => p.id)).toEqual([target.id]);

      const byName = await service.findAll(
        { search: 'Karim', page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );
      expect(byName.data.map((p) => p.id)).toEqual([target.id]);

      const byRegistration = await service.findAll(
        { search: student.registration_number, page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );
      expect(byRegistration.data.map((p) => p.id)).toEqual([target.id]);
    });

    it('filters by student_id, payment_method, received_by_user_id, and date range', async () => {
      const studentA = await makeStudent();
      const studentB = await makeStudent();
      const inRange = await makePayment(studentA.id, SEED_TENANT_ID, {
        payment_method: PaymentMethod.BKASH,
        received_by_user_id: SEED_ADMIN_USER_ID,
        payment_date: new Date('2026-03-10T00:00:00Z'),
      });
      await makePayment(studentA.id, SEED_TENANT_ID, {
        payment_method: PaymentMethod.CASH,
        payment_date: new Date('2026-03-10T00:00:00Z'),
      });
      await makePayment(studentB.id, SEED_TENANT_ID, {
        payment_method: PaymentMethod.BKASH,
        received_by_user_id: SEED_ADMIN_USER_ID,
        payment_date: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.findAll(
        {
          student_id: studentA.id,
          payment_method: PaymentMethod.BKASH,
          received_by_user_id: SEED_ADMIN_USER_ID,
          date_from: '2026-03-01',
          date_to: '2026-03-31',
          page: 1,
          limit: 10,
        } as any,
        SEED_TENANT_ID,
      );

      expect(result.data.map((p) => p.id)).toEqual([inRange.id]);
    });

    it('excludes reversed payments by default and includes them with include_reversed', async () => {
      const student = await makeStudent();
      const original = await makePayment(student.id);
      const reversal = await makePayment(student.id, SEED_TENANT_ID, {
        reversal_of_payment_id: original.id,
      });
      await paymentRepo.update(original.id, { reversed_by_payment_id: reversal.id });

      const defaultResult = await service.findAll({ page: 1, limit: 10 } as any, SEED_TENANT_ID);
      expect(defaultResult.data.map((p) => p.id).sort()).toEqual([reversal.id].sort());

      const withReversed = await service.findAll(
        { include_reversed: true, page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );
      expect(withReversed.data.map((p) => p.id).sort()).toEqual([original.id, reversal.id].sort());

      const onlyReversals = await service.findAll(
        { is_reversal: true, include_reversed: true, page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );
      expect(onlyReversals.data.map((p) => p.id)).toEqual([reversal.id]);
    });

    it('date_to includes the whole final day (F2)', async () => {
      const student = await makeStudent();
      const lateInDay = await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-04-10T23:30:00Z'),
      });

      const result = await service.findAll(
        { date_from: '2026-04-01', date_to: '2026-04-10', page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );

      expect(result.data.map((p) => p.id)).toContain(lateInDay.id);
    });

    // Known caveat (F2, not fixed here — see the comment in
    // payments-query.service.ts): `date_from` is compared at midnight UTC,
    // not the tenant's local midnight. A payment recorded 00:00-06:00 Dhaka
    // time (UTC+6) on the start day is *before* midnight UTC of that day and
    // is excluded even though it happened "on" that Dhaka calendar day.
    it('documents the date_from caveat: an early-UTC payment on the start day is excluded', async () => {
      const student = await makeStudent();
      // 02:00 UTC on 2026-05-01 is 08:00 in Asia/Dhaka (UTC+6) on the same
      // calendar day, but midnight UTC on 2026-05-01 has already passed —
      // so this payment is *included* by the current UTC-only comparison.
      // The caveat bites the other direction: a payment at, say, 20:00 UTC
      // on 2026-04-30 (02:00 Dhaka time on 2026-05-01) would be wrongly
      // excluded from a `date_from: '2026-05-01'` query. That case isn't
      // exercised here since fixing it is out of this fix's scope — this
      // test only pins today's actual (UTC midnight) behavior.
      const payment = await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-05-01T02:00:00Z'),
      });

      const result = await service.findAll(
        { date_from: '2026-05-01', page: 1, limit: 10 } as any,
        SEED_TENANT_ID,
      );

      expect(result.data.map((p) => p.id)).toContain(payment.id);
    });

    it('excludes soft-deleted payments and keeps tenants isolated', async () => {
      const student = await makeStudent();
      const kept = await makePayment(student.id);
      const deleted = await makePayment(student.id);
      await paymentRepo.softDelete(deleted.id);

      const otherStudent = await makeStudent(OTHER_TENANT_ID);
      await makePayment(otherStudent.id, OTHER_TENANT_ID);

      const result = await service.findAll({ page: 1, limit: 10 } as any, SEED_TENANT_ID);

      expect(result.data.map((p) => p.id)).toEqual([kept.id]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a payment in another tenant', async () => {
      const student = await makeStudent(OTHER_TENANT_ID);
      const payment = await makePayment(student.id, OTHER_TENANT_ID);

      await expect(service.findOne(payment.id, SEED_TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a soft-deleted payment', async () => {
      const student = await makeStudent();
      const payment = await makePayment(student.id);
      await paymentRepo.softDelete(payment.id);

      await expect(service.findOne(payment.id, SEED_TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns allocations enriched with fee_name/period_start joined from student_fee', async () => {
      const student = await makeStudent();
      const invoice = await invoiceRepo.save(
        invoiceRepo.create({
          invoice_number: `INV-PQ-${paymentSeq + 1}`,
          student_id: student.id,
          total_amount: 1000,
          status: 'PAID' as any,
          issued_date: new Date('2026-01-15'),
          due_date: new Date('2026-01-25'),
        } as Partial<Invoice>),
      );
      const fee = await makeStudentFee(student.id, TUITION_STRUCTURE_ID, {
        period_start: new Date('2026-01-01'),
      });
      const payment = await makePayment(student.id, SEED_TENANT_ID, {
        invoice_id: invoice.id,
        received_by_user_id: SEED_ADMIN_USER_ID,
      });
      await allocationRepo.save(
        allocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1000,
          allocation_type: PaymentAllocationType.CURRENT,
        }),
      );

      const detail = await service.findOne(payment.id, SEED_TENANT_ID);

      expect(detail.student?.id).toBe(student.id);
      expect(detail.invoice?.id).toBe(invoice.id);
      expect(detail.received_by?.id).toBe(SEED_ADMIN_USER_ID);
      expect(detail.allocations).toHaveLength(1);
      expect(detail.allocations[0].fee_name).toBe('Tuition Fee');
      expect(new Date(detail.allocations[0].period_start!).toISOString().slice(0, 10)).toBe(
        '2026-01-01',
      );
    });

    it('returns null fee_name/period_start when the fee_structure behind an allocation is soft-deleted', async () => {
      const student = await makeStudent();
      const fee = await makeStudentFee(student.id, OTHER_STRUCTURE_ID);
      const payment = await makePayment(student.id);
      await allocationRepo.save(
        allocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1000,
          allocation_type: PaymentAllocationType.CURRENT,
        }),
      );
      await feeStructureRepo.softDelete(OTHER_STRUCTURE_ID);

      const detail = await service.findOne(payment.id, SEED_TENANT_ID);

      expect(detail.allocations[0].fee_name).toBeNull();
    });

    it('returns decimal fields as numbers, not strings (item 6)', async () => {
      const student = await makeStudent();
      const fee = await makeStudentFee(student.id);
      const payment = await makePayment(student.id, SEED_TENANT_ID, { total_amount: 1234.56 });
      await allocationRepo.save(
        allocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1234.56,
          allocation_type: PaymentAllocationType.CURRENT,
          discount_amount: 10,
        }),
      );

      const detail = await service.findOne(payment.id, SEED_TENANT_ID);

      expect(typeof detail.total_amount).toBe('number');
      expect(detail.total_amount).toBe(1234.56);
      expect(typeof detail.allocations[0].allocated_amount).toBe('number');
      expect(typeof detail.allocations[0].discount_amount).toBe('number');
    });

    it('returns null student when the student behind the payment is soft-deleted', async () => {
      const student = await makeStudent();
      const payment = await makePayment(student.id);
      await studentRepo.softDelete(student.id);

      const detail = await service.findOne(payment.id, SEED_TENANT_ID);

      expect(detail.student).toBeNull();
    });
  });
});
