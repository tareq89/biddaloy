import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  PaymentReversalService,
  ReverseLaterPaymentsFirstException,
} from './payment-reversal.service';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { StorageModule } from '../storage/storage.module';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { Student } from '../students/entities/student.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
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
import { FeeStatus, FeeType, PaymentMethod, InvoiceStatus, InvoiceKind } from '@biddaloy/shared';

/**
 * Integration tests for `PaymentReversalService` (16.6.1) — reverses a
 * payment in full: unwinds wallet movements, restores bills, cancels the
 * invoice via a credit note. Fixtures go through the real `CheckoutService`
 * first (same reasoning as reusing `applyAllocationToBill`: exercising the
 * real forward flow before reversing it is a stronger test than hand-built
 * Payment/PaymentAllocation rows).
 */

const JWT_SECRET = 'test-reversal-secret';
const TENANT_ID = SEED_TENANT_ID;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const ACTOR_USER_ID = SEED_ADMIN_USER_ID;
const APPROVER_USER_ID = SEED_ADMIN_USER_ID;

let studentSeq = 0;

function daysFromToday(offset: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

describe('PaymentReversalService (integration)', () => {
  let service: PaymentReversalService;
  let checkoutService: CheckoutService;
  let walletService: WalletService;
  let redis: Redis;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let paymentRepo: Repository<Payment>;
  let allocationRepo: Repository<PaymentAllocation>;
  let invoiceRepo: Repository<Invoice>;
  let auditLogRepo: Repository<AuditLog>;
  let feeStructureRepo: Repository<FeeStructure>;
  let dataSource: DataSource;
  let feeStructureId: string;

  function makeStudent() {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Reversal Student ${studentSeq}`,
      registration_number: `REG-REV-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
    });
  }

  function makeBill(studentId: string, overrides: Partial<StudentFee> = {}) {
    return studentFeeRepo.create({
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      fee_structure_id: feeStructureId,
      period_start: daysFromToday(-60),
      period_type: 'MONTH' as any,
      occurrence: 1,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      status: FeeStatus.PENDING,
      due_date: daysFromToday(-10),
      ...overrides,
    });
  }

  function requestWithToken() {
    return { headers: {}, currentTenant: { id: TENANT_ID }, user: { sub: ACTOR_USER_ID } };
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PaymentReversalService,
        CheckoutService,
        WalletService,
        AuditService,
        InvoicesService,
        ApprovalService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
      ],
      [StorageModule],
    );

    service = module.get<PaymentReversalService>(PaymentReversalService);
    checkoutService = module.get<CheckoutService>(CheckoutService);
    walletService = module.get<WalletService>(WalletService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    allocationRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
    invoiceRepo = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
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
      schoolRepo.create({ id: TENANT_ID, name: 'Test School', slug: 'test-reversal' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-reversal' }),
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
        name: 'Class 1',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    await sectionRepo.save(
      sectionRepo.create({
        id: SEED_SECTION_1_ID,
        section_name: 'A',
        class_id: SEED_CLASS_1_ID,
        tenant_id: TENANT_ID,
      }),
    );
  }, 60000);

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM wallet_transactions');
    await dataSource.query('DELETE FROM student_wallets');
    await dataSource.query('DELETE FROM payment_allocations');
    await dataSource.query('DELETE FROM invoices');
    await dataSource.query('DELETE FROM payments');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM students WHERE tenant_id = $1', [TENANT_ID]);

    const structure = await feeStructureRepo.save(
      feeStructureRepo.create({
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    feeStructureId = structure.id;
  });

  it('reverses a full payment: unwinds bill, cancels invoice, marks reversed', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111101',
        lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const reversal = await service.reverse(
      payment.id,
      TENANT_ID,
      ACTOR_USER_ID,
      APPROVER_USER_ID,
      'Cashier recorded the wrong bill',
    );

    // Reversal payment mirrors the original amount (positive) — DB check
    // constraints (`CHK_pay_total_amount`) require it; `reversal_of_payment_id`
    // is what marks the row as a reversal, not the sign.
    expect(Number(reversal.total_amount)).toBe(1000);
    expect(reversal.reversal_of_payment_id).toBe(payment.id);

    const original = await paymentRepo.findOneByOrFail({ id: payment.id });
    expect(original.reversed_by_payment_id).toBe(reversal.id);

    const updatedBill = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(Number(updatedBill.paid_amount)).toBe(0);
    expect(updatedBill.status).toBe(FeeStatus.PENDING);

    const invoices = await invoiceRepo.find({ where: { payment_id: payment.id } });
    const invoice = invoices.find((i) => i.kind === InvoiceKind.INVOICE)!;
    const creditNote = invoices.find((i) => i.kind === InvoiceKind.CREDIT_NOTE)!;
    expect(invoice.status).toBe(InvoiceStatus.CANCELLED);
    expect(creditNote).toBeTruthy();
    // Credit note mirrors the original amount (positive) too — `kind`
    // is the discriminator (see `InvoicesService.createCreditNote`).
    expect(Number(creditNote.total_amount)).toBe(1000);

    const reversalAllocations = await allocationRepo.find({ where: { payment_id: reversal.id } });
    expect(reversalAllocations).toHaveLength(1);
    expect(Number(reversalAllocations[0].allocated_amount)).toBe(1000);
  });

  it('rejects reversing an already-reversed payment (409)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111102',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'first reversal');

    await expect(
      service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'second attempt'),
    ).rejects.toThrow(ConflictException);
  });

  it('tenant isolation: refuses to reverse a payment belonging to a different tenant (404)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111199',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    // `PaymentReversalService.reverse`'s first lookup is
    // `where: { id: paymentId, tenant_id: tenantId }` — a caller scoped to
    // OTHER_TENANT_ID must get the same 404 as a nonexistent id, not a
    // cross-tenant peek at whether the payment exists.
    await expect(
      service.reverse(payment.id, OTHER_TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong tenant'),
    ).rejects.toThrow(NotFoundException);

    // The payment is untouched — still reversible by its own tenant.
    const untouched = await paymentRepo.findOneByOrFail({ id: payment.id });
    expect(untouched.reversed_by_payment_id).toBeNull();
  });

  it('rejects reversing a reversal payment itself (400 CANNOT_REVERSE_A_REVERSAL)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111103',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const reversal = await service.reverse(
      payment.id,
      TENANT_ID,
      ACTOR_USER_ID,
      APPROVER_USER_ID,
      'first reversal',
    );

    await expect(
      service.reverse(
        reversal.id,
        TENANT_ID,
        ACTOR_USER_ID,
        APPROVER_USER_ID,
        'reverse the reversal',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('reverse-in-order (D10): refuses to reverse a payment whose wallet credit was already spent (409 REVERSE_LATER_PAYMENTS_FIRST)', async () => {
    const student = await studentRepo.save(makeStudent());
    // Two distinct bills for the same student need distinct `occurrence`
    // values — `makeBill`'s defaults (same `fee_structure_id` + same
    // `period_start`) would otherwise collide on the
    // `(student_id, fee_structure_id, period_start, occurrence)` unique
    // index (`IDX_student_fees_active_student_structure_period_occurrence`).
    const billOverpaid = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 500, occurrence: 1 }),
    );
    const billLater = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 300, occurrence: 2 }),
    );

    // Overpay by 200 with change routed TO_WALLET — wallet_credit_added=200.
    const { payment: overpayment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111104',
        lines: [{ student_fee_id: billOverpaid.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 700,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(200);

    // Spend that wallet credit on a later payment.
    await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111105',
        lines: [{ student_fee_id: billLater.id, amount: 300, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        wallet_use: 200,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);

    await expect(
      service.reverse(overpayment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'too late'),
    ).rejects.toThrow(ReverseLaterPaymentsFirstException);
  });

  it('unwinds wallet credit used at checkout back into the wallet balance', async () => {
    const student = await studentRepo.save(makeStudent());
    // Same reason as the reverse-in-order test above: distinct `occurrence`
    // per bill to avoid colliding on the unique index.
    const billForCredit = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 500, occurrence: 1 }),
    );
    const billUsingCredit = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 300, occurrence: 2 }),
    );

    await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111106',
        lines: [{ student_fee_id: billForCredit.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 700,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const { payment: spendingPayment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111107',
        lines: [{ student_fee_id: billUsingCredit.id, amount: 300, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        wallet_use: 200,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);

    await service.reverse(
      spendingPayment.id,
      TENANT_ID,
      ACTOR_USER_ID,
      APPROVER_USER_ID,
      'refund the wallet spend',
    );

    // The 200 wallet credit spent by the reversed payment comes back.
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(200);

    const updatedBillUsingCredit = await studentFeeRepo.findOneByOrFail({ id: billUsingCredit.id });
    expect(Number(updatedBillUsingCredit.paid_amount)).toBe(0);
  });

  it('records an approved audit-log entry for the reversal', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111108',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong bill');

    const logs = await auditLogRepo.find({
      where: { entity_type: 'Payment', entity_id: payment.id, tenant_id: TENANT_ID },
    });
    expect(logs.length).toBeGreaterThan(0);
    const reversalLog = logs.find((l) => (l.new_values as any)?.reversal_reason === 'wrong bill');
    expect(reversalLog).toBeTruthy();
    expect((reversalLog!.new_values as any).approved_by_user_id).toBe(APPROVER_USER_ID);
  });
});
