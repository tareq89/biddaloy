import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentAllocationService } from './payment-allocation.service';
import { StudentFee } from './entities/student-fee.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
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
import { FeeStatus, PaymentMethod, PaymentAllocationType, AuditAction } from '@beton-boi/shared';

/**
 * Integration tests for PaymentAllocationService (issue #13 — record-with-allocation).
 *
 * Runs against a real PostgreSQL database. Verifies partial/full payment
 * handling, FIFO ordering enforcement (dues before current before advance),
 * auto-generated invoices on full payment, AuditLog writes, tenant
 * isolation, and the pessimistic lock preventing concurrent double-spend.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

/** Returns {month, year} for `offset` months relative to today, so DUE/CURRENT/ADVANCE
 * classification always lines up with the service's `new Date()`-based logic regardless
 * of when the test suite runs. */
function monthOffset(offset: number): { month: number; year: number } {
  const d = new Date();
  d.setDate(1); // avoid month-end rollover surprises
  d.setMonth(d.getMonth() + offset);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

let studentSeq = 0;

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM audit_logs');
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM invoices');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM student_guardians');
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

  await schoolRepo.save(schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school', tenant_id: SEED_TENANT_ID }));
  await userRepo.save(userRepo.create({
    id: SEED_ADMIN_USER_ID,
    email: SEED_ADMIN_EMAIL,
    password_hash: SEED_ADMIN_PASSWORD_HASH,
    full_name: 'Test Admin',
  }));
  await ayRepo.save(ayRepo.create({ id: SEED_ACADEMIC_YEAR_ID, name: '2026-2027', start_date: new Date('2020-01-01'), end_date: new Date('2035-12-31'), is_current: true, tenant_id: SEED_TENANT_ID }));
  await classRepo.save(classRepo.create({ id: SEED_CLASS_1_ID, name: 'Class One', academic_year_id: SEED_ACADEMIC_YEAR_ID, tenant_id: SEED_TENANT_ID }));
  await sectionRepo.save(sectionRepo.create({ id: SEED_SECTION_1_ID, section_name: 'Section A', class_id: SEED_CLASS_1_ID, tenant_id: SEED_TENANT_ID }));

  await schoolRepo.save(schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school', tenant_id: OTHER_TENANT_ID }));
}

describe('PaymentAllocationService (integration)', () => {
  let service: PaymentAllocationService;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let paymentRepo: Repository<Payment>;
  let allocationRepo: Repository<PaymentAllocation>;
  let invoiceRepo: Repository<Invoice>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Student ${studentSeq}`,
      registration_number: `REG-PAY-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
      ...overrides,
    });
  }

  function makeFee(studentId: string, offset: number, overrides: Partial<StudentFee> = {}) {
    const { month, year } = monthOffset(offset);
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      month,
      year,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      status: FeeStatus.PENDING,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [PaymentAllocationService],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<PaymentAllocationService>(PaymentAllocationService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    allocationRepo = module.get<Repository<PaymentAllocation>>(getRepositoryToken(PaymentAllocation));
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
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
      await dataSource.query('DELETE FROM payment_allocations');
      await dataSource.query('DELETE FROM invoices');
      await dataSource.query('DELETE FROM payments');
      await dataSource.query('DELETE FROM student_fees');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('partial payment', () => {
    it('updates paid_amount and sets status PARTIALLY_PAID, no invoice generated', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0)); // current month

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 400,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: fee.id, allocated_amount: 400, allocation_type: PaymentAllocationType.CURRENT }],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(Number(result.total_amount)).toBe(400);
      expect(result.invoice_id).toBeNull();
      expect(result.received_by_user_id).toBe(SEED_ADMIN_USER_ID);

      const updatedFee = await studentFeeRepo.findOne({ where: { id: fee.id } });
      expect(Number(updatedFee!.paid_amount)).toBe(400);
      expect(updatedFee!.status).toBe(FeeStatus.PARTIALLY_PAID);

      const invoices = await invoiceRepo.find();
      expect(invoices).toHaveLength(0);
    });
  });

  describe('full payment', () => {
    it('changes status to PAID and auto-generates an invoice', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 1000,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: fee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.invoice_id).not.toBeNull();

      const updatedFee = await studentFeeRepo.findOne({ where: { id: fee.id } });
      expect(updatedFee!.status).toBe(FeeStatus.PAID);
      expect(Number(updatedFee!.paid_amount)).toBe(1000);

      const invoice = await invoiceRepo.findOne({ where: { id: result.invoice_id! } });
      expect(invoice).toBeDefined();
      expect(Number(invoice!.total_amount)).toBe(1000);
      expect(invoice!.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
    });

    it('does not generate an invoice when generate_invoice is false', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 1000,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: fee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
          generate_invoice: false,
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.invoice_id).toBeNull();
      const invoices = await invoiceRepo.find();
      expect(invoices).toHaveLength(0);
    });

    it('assigns sequential invoice numbers across separate payments', async () => {
      const student1 = await studentRepo.save(makeStudent());
      const student2 = await studentRepo.save(makeStudent());
      const fee1 = await studentFeeRepo.save(makeFee(student1.id, 0));
      const fee2 = await studentFeeRepo.save(makeFee(student2.id, 0));

      const r1 = await service.recordWithAllocation(
        { student_id: student1.id, total_amount: 1000, payment_method: PaymentMethod.CASH, allocations: [{ student_fee_id: fee1.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }] } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const r2 = await service.recordWithAllocation(
        { student_id: student2.id, total_amount: 1000, payment_method: PaymentMethod.CASH, allocations: [{ student_fee_id: fee2.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }] } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const inv1 = await invoiceRepo.findOne({ where: { id: r1.invoice_id! } });
      const inv2 = await invoiceRepo.findOne({ where: { id: r2.invoice_id! } });
      const seq1 = parseInt(inv1!.invoice_number.split('-')[2], 10);
      const seq2 = parseInt(inv2!.invoice_number.split('-')[2], 10);
      expect(seq2).toBe(seq1 + 1);
    });
  });

  describe('FIFO allocation', () => {
    it('allocates oldest dues first, then current, then advance in one payment', async () => {
      const student = await studentRepo.save(makeStudent());
      const dueOld = await studentFeeRepo.save(makeFee(student.id, -2, { total_amount: 500 }));
      const dueRecent = await studentFeeRepo.save(makeFee(student.id, -1, { total_amount: 500 }));
      const current = await studentFeeRepo.save(makeFee(student.id, 0, { total_amount: 500 }));
      const advance = await studentFeeRepo.save(makeFee(student.id, 1, { total_amount: 500 }));

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 2000,
          payment_method: PaymentMethod.CASH,
          allocations: [
            { student_fee_id: dueOld.id, allocated_amount: 500, allocation_type: PaymentAllocationType.DUE },
            { student_fee_id: dueRecent.id, allocated_amount: 500, allocation_type: PaymentAllocationType.DUE },
            { student_fee_id: current.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT },
            { student_fee_id: advance.id, allocated_amount: 500, allocation_type: PaymentAllocationType.ADVANCE },
          ],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(result.invoice_id).not.toBeNull();
      const fees = await studentFeeRepo.find({ where: { student_id: student.id } });
      expect(fees.every((f) => f.status === FeeStatus.PAID)).toBe(true);

      const allocations = await allocationRepo.find({ where: { payment_id: result.id } });
      expect(allocations).toHaveLength(4);
      const byFee = new Map(allocations.map((a) => [a.student_fee_id, a.allocation_type]));
      expect(byFee.get(dueOld.id)).toBe(PaymentAllocationType.DUE);
      expect(byFee.get(dueRecent.id)).toBe(PaymentAllocationType.DUE);
      expect(byFee.get(current.id)).toBe(PaymentAllocationType.CURRENT);
      expect(byFee.get(advance.id)).toBe(PaymentAllocationType.ADVANCE);
    });

    it('rejects paying a newer due while an older due remains outstanding', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, -2, { total_amount: 500 }));
      const dueRecent = await studentFeeRepo.save(makeFee(student.id, -1, { total_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 500,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: dueRecent.id, allocated_amount: 500, allocation_type: PaymentAllocationType.DUE }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects paying current month while a due remains outstanding', async () => {
      const student = await studentRepo.save(makeStudent());
      await studentFeeRepo.save(makeFee(student.id, -1, { total_amount: 500 }));
      const current = await studentFeeRepo.save(makeFee(student.id, 0, { total_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 500,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: current.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an allocation whose type does not match the fee period', async () => {
      const student = await studentRepo.save(makeStudent());
      const due = await studentFeeRepo.save(makeFee(student.id, -1, { total_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 500,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: due.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves everything unchanged (rolled back) when a FIFO violation is thrown', async () => {
      const student = await studentRepo.save(makeStudent());
      const dueOld = await studentFeeRepo.save(makeFee(student.id, -2, { total_amount: 500 }));
      const dueRecent = await studentFeeRepo.save(makeFee(student.id, -1, { total_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 500,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: dueRecent.id, allocated_amount: 500, allocation_type: PaymentAllocationType.DUE }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      const payments = await paymentRepo.find({ where: { student_id: student.id } });
      expect(payments).toHaveLength(0);
      const unchanged = await studentFeeRepo.findOne({ where: { id: dueOld.id } });
      expect(Number(unchanged!.paid_amount)).toBe(0);
    });
  });

  describe('validation', () => {
    it('rejects when allocation amounts do not sum to total_amount', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: fee.id, allocated_amount: 400, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate student_fee_id entries in allocations', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [
              { student_fee_id: fee.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT },
              { student_fee_id: fee.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT },
            ],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an allocated_amount that exceeds the fee remaining balance', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0, { total_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: fee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an allocation against a fee that is already fully covered by discount', async () => {
      const student = await studentRepo.save(makeStudent());
      // total_amount === discount_amount, so remaining is 0 even though status
      // is still PENDING (nothing has re-evaluated the status) — this fee must
      // not silently absorb money with no PaymentAllocation to show for it.
      const fee = await studentFeeRepo.save(makeFee(student.id, 0, { total_amount: 500, discount_amount: 500 }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 500,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: fee.id, allocated_amount: 500, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      const payments = await paymentRepo.find({ where: { student_id: student.id } });
      expect(payments).toHaveLength(0);
    });

    it('throws NotFoundException when student does not exist', async () => {
      await expect(
        service.recordWithAllocation(
          {
            student_id: '00000000-0000-4000-8000-000000000000',
            total_amount: 100,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: '00000000-0000-4000-8000-000000000001', allocated_amount: 100, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when student belongs to a different tenant', async () => {
      const student = await studentRepo.save(makeStudent({ tenant_id: OTHER_TENANT_ID, class_section_id: SEED_SECTION_1_ID }));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 100,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: '00000000-0000-4000-8000-000000000001', allocated_amount: 100, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when a student_fee_id does not belong to the student or is already paid', async () => {
      const student = await studentRepo.save(makeStudent());
      const otherStudent = await studentRepo.save(makeStudent());
      const foreignFee = await studentFeeRepo.save(makeFee(otherStudent.id, 0));

      await expect(
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: foreignFee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('AuditLog', () => {
    it('creates a PAYMENT_RECEIVED entry for every payment', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 400,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: fee.id, allocated_amount: 400, allocation_type: PaymentAllocationType.CURRENT }],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const logs = await auditLogRepo.find({ where: { entity_id: result.id, action: AuditAction.PAYMENT_RECEIVED } });
      expect(logs).toHaveLength(1);
      expect(logs[0].performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
      expect(logs[0].entity_type).toBe('Payment');
    });

    it('creates an additional INVOICE_GENERATED entry on full payment', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0));

      const result = await service.recordWithAllocation(
        {
          student_id: student.id,
          total_amount: 1000,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: fee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const logs = await auditLogRepo.find({ where: { entity_id: result.invoice_id!, action: AuditAction.INVOICE_GENERATED } });
      expect(logs).toHaveLength(1);
    });
  });

  describe('concurrency', () => {
    it('prevents two concurrent full payments from double-spending the same fee', async () => {
      const student = await studentRepo.save(makeStudent());
      const fee = await studentFeeRepo.save(makeFee(student.id, 0, { total_amount: 1000 }));

      const attempt = () =>
        service.recordWithAllocation(
          {
            student_id: student.id,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: fee.id, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        );

      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const updatedFee = await studentFeeRepo.findOne({ where: { id: fee.id } });
      expect(Number(updatedFee!.paid_amount)).toBe(1000);
      expect(updatedFee!.status).toBe(FeeStatus.PAID);

      const payments = await paymentRepo.find({ where: { student_id: student.id } });
      expect(payments).toHaveLength(1);
    });

    it('assigns distinct invoice numbers to two concurrent full payments for different students', async () => {
      // Regression test for the invoice-number race: a row lock on the
      // "current max" invoice does nothing to protect two transactions that
      // both find zero existing rows for the year and would otherwise both
      // compute nextSeq=1. The advisory lock in generateInvoiceNumber must
      // serialize this regardless of same-fee locking.
      const studentA = await studentRepo.save(makeStudent());
      const studentB = await studentRepo.save(makeStudent());
      const feeA = await studentFeeRepo.save(makeFee(studentA.id, 0, { total_amount: 1000 }));
      const feeB = await studentFeeRepo.save(makeFee(studentB.id, 0, { total_amount: 1000 }));

      const pay = (studentId: string, feeId: string) =>
        service.recordWithAllocation(
          {
            student_id: studentId,
            total_amount: 1000,
            payment_method: PaymentMethod.CASH,
            allocations: [{ student_fee_id: feeId, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
          } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        );

      const [resultA, resultB] = await Promise.all([pay(studentA.id, feeA.id), pay(studentB.id, feeB.id)]);

      expect(resultA.invoice_id).not.toBeNull();
      expect(resultB.invoice_id).not.toBeNull();
      expect(resultA.invoice_id).not.toBe(resultB.invoice_id);

      const invoices = await invoiceRepo.find({ where: [{ id: resultA.invoice_id! }, { id: resultB.invoice_id! }] });
      const numbers = invoices.map((i) => i.invoice_number);
      expect(new Set(numbers).size).toBe(2);
    });
  });
});
