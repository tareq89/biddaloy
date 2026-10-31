import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../attention/engine/attention-events';
import { getQueueToken } from '@nestjs/bullmq';
import { FEE_NOTIFY_QUEUE } from '../communications/communications.constants';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { returnMoneyOfRemovedBills } from './removed-bill-money';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  PaymentReversalService,
  ReverseLaterPaymentsFirstException,
  SecondApproverRequiredException,
} from './payment-reversal.service';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SchoolsService } from '../schools/schools.service';
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
import {
  FeeStatus,
  FeeType,
  PaymentMethod,
  PaymentAllocationType,
  InvoiceStatus,
  InvoiceKind,
  PaymentStatus,
  WalletTransactionKind,
  AuditAction,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';

/**
 * Integration tests for `PaymentReversalService` (16.6.1) — reverses a
 * payment in full: unwinds wallet movements, restores bills, cancels the
 * invoice via a credit note. Fixtures go through the real `CheckoutService`
 * first (same reasoning as reusing `applyAllocationToBill`: exercising the
 * real forward flow before reversing it is a stronger test than hand-built
 * Payment/PaymentAllocation rows).
 */

const JWT_SECRET = 'test-reversal-secret';

/** [78 D1] What the SchoolsService stub resolves; reset before every test. */
let settings: Record<string, unknown> = {};
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

const feeNotifyAdd = vi.fn().mockResolvedValue(undefined);
/** Collects the attention rechecks emitted while `fn` runs. */
async function captureRechecks(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: AttentionRecheckPayload[] = [];
  const on = (p: AttentionRecheckPayload) => seen.push(p);
  attentionEvents.on(ATTENTION_RECHECK, on);
  try {
    await fn();
  } finally {
    attentionEvents.off(ATTENTION_RECHECK, on);
  }
  return seen.map((r) => `${r.tenantId}:${r.ruleKey}`).sort();
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
        { provide: getQueueToken(FEE_NOTIFY_QUEUE), useValue: { add: feeNotifyAdd } },
        { provide: SchoolsService, useValue: { getResolvedSettings: async () => settings } },
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
    settings = {};
    await dataSource.query('DELETE FROM user_tenants');
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

  // [78 D1] Self-approval is allowed only in a single-admin school, and never
  // when the school asks for a second approver.
  describe('self-approved reversal (78 D1)', () => {
    let seq = 0;

    async function paidPayment() {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
      seq += 1;
      const { payment } = await checkoutService.checkout(
        {
          idempotency_key: `d1d1d1d1-d1d1-4d1d-8d1d-${String(seq).padStart(12, '0')}`,
          lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
        } as any,
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      return { payment, bill };
    }

    async function membership(
      role: UserRole,
      opts: { tenantId?: string; status?: UserStatus; deleted?: boolean } = {},
    ) {
      const userRepo = dataSource.getRepository(User);
      seq += 1;
      const user = await userRepo.save(
        userRepo.create({
          email: `second-approver-${seq}@example.com`,
          full_name: 'Second Approver',
          status: opts.status ?? UserStatus.ACTIVE,
          password_hash: null,
        }),
      );
      const membershipRepo = dataSource.getRepository(UserTenant);
      const row = await membershipRepo.save(
        membershipRepo.create({ user_id: user.id, tenant_id: opts.tenantId ?? TENANT_ID, role }),
      );
      if (opts.deleted) await membershipRepo.softDelete({ id: row.id });
      return user;
    }

    /** The actor's own ADMIN row. Every allow-path case inserts it first, so a
     * pass proves `Not(actorUserId)` excludes the actor from "another approver". */
    async function actorIsAdmin() {
      const membershipRepo = dataSource.getRepository(UserTenant);
      await membershipRepo.save(
        membershipRepo.create({
          user_id: ACTOR_USER_ID,
          tenant_id: TENANT_ID,
          role: UserRole.ADMIN,
        }),
      );
    }

    async function expectRefused(paymentId: string, billId: string) {
      await expect(
        service.reverse(paymentId, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self'),
      ).rejects.toBeInstanceOf(SecondApproverRequiredException);
      const original = await paymentRepo.findOneByOrFail({ id: paymentId });
      expect(original.reversed_by_payment_id).toBeNull();
      expect(await paymentRepo.count({ where: { reversal_of_payment_id: paymentId } })).toBe(0);
      expect(Number((await studentFeeRepo.findOneByOrFail({ id: billId })).paid_amount)).toBe(1000);
      expect(await dataSource.getRepository(WalletTransaction).count()).toBe(0);
      expect(
        await auditLogRepo.count({ where: { entity_type: 'Payment', action: AuditAction.UPDATE } }),
      ).toBe(0);
    }

    it('single admin, setting absent: self-approval succeeds and the audit row says so', async () => {
      await actorIsAdmin();
      const { payment } = await paidPayment();

      await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self');

      const [row] = await auditLogRepo.find({
        where: { entity_type: 'Payment', action: AuditAction.UPDATE },
      });
      expect(row.new_values).toMatchObject({
        approved_by_user_id: row.performed_by_user_id,
        self_approved: true,
      });
    });

    it('a second ACTIVE ADMIN in the school: self-approval is refused and nothing changes', async () => {
      await actorIsAdmin();
      await membership(UserRole.ADMIN);
      const { payment, bill } = await paidPayment();

      await expectRefused(payment.id, bill.id);
      const error = await service
        .reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self')
        .catch((e) => e);
      expect(error.getResponse()).toEqual({
        message: 'Another approver is needed for this reversal',
        details: { code: 'SECOND_APPROVER_REQUIRED' },
      });
    });

    it('a SUSPENDED second ADMIN does not count', async () => {
      await actorIsAdmin();
      await membership(UserRole.ADMIN, { status: UserStatus.SUSPENDED });
      const { payment } = await paidPayment();

      await expect(
        service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self'),
      ).resolves.toBeDefined();
    });

    it('a soft-deleted second ADMIN membership does not count', async () => {
      await actorIsAdmin();
      await membership(UserRole.ADMIN, { deleted: true });
      const { payment } = await paidPayment();

      await expect(
        service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self'),
      ).resolves.toBeDefined();
    });

    it('an ADMIN of a different school does not count (tenant isolation)', async () => {
      await actorIsAdmin();
      await membership(UserRole.ADMIN, { tenantId: OTHER_TENANT_ID });
      const { payment } = await paidPayment();

      await expect(
        service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self'),
      ).resolves.toBeDefined();
    });

    it('a SUPER_ADMIN membership in the school does not count (D23)', async () => {
      await actorIsAdmin();
      await membership(UserRole.SUPER_ADMIN);
      const { payment } = await paidPayment();

      await expect(
        service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, ACTOR_USER_ID, 'self'),
      ).resolves.toBeDefined();
    });

    it('setting true with a single admin: self-approval is refused', async () => {
      settings = { fees: { requireSecondApprover: true } };
      const { payment, bill } = await paidPayment();

      await expectRefused(payment.id, bill.id);
    });

    it('setting true with a distinct approver: succeeds with self_approved: false', async () => {
      settings = { fees: { requireSecondApprover: true } };
      const approver = await membership(UserRole.ADMIN);
      const { payment } = await paidPayment();

      await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, approver.id, 'other');

      const [row] = await auditLogRepo.find({
        where: { entity_type: 'Payment', action: AuditAction.UPDATE },
      });
      expect(row.new_values).toMatchObject({
        approved_by_user_id: approver.id,
        self_approved: false,
      });
    });
  });

  it('a committed reversal rechecks the fee alerts', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 400 }));
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111177',
        lines: [{ student_fee_id: bill.id, amount: 400, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const rechecks = await captureRechecks(() =>
      service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong amount'),
    );

    expect(rechecks).toEqual(
      [`${TENANT_ID}:fees.due_soon`, `${TENANT_ID}:fees.overdue_family`].sort(),
    );
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

  it('replaying the key of a reversed payment is a 409 CHECKOUT_PAYMENT_REVERSED (#2637)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const body = {
      idempotency_key: '2637a001-0000-4000-8000-000000000001',
      lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
    } as any;

    const { payment } = await checkoutService.checkout(
      body,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong bill');

    const err = await checkoutService
      .checkout(body, TENANT_ID, ACTOR_USER_ID, requestWithToken())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ details: { code: 'CHECKOUT_PAYMENT_REVERSED' } });
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

  async function payThenRemoveBill(studentId: string, key: string, billOverrides = {}) {
    const bill = await studentFeeRepo.save(
      makeBill(studentId, { total_amount: 1000, ...billOverrides }),
    );
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    // Staff deletes the paid bill: it is soft-deleted and the money goes to the wallet.
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(StudentFee).softDelete({ id: bill.id });
      const removed = await manager
        .getRepository(StudentFee)
        .find({ where: { id: bill.id }, withDeleted: true });
      await returnMoneyOfRemovedBills(manager, walletService, removed, TENANT_ID, ACTOR_USER_ID);
    });
    return { bill, payment };
  }

  it('MON-03: reversing a payment whose bill was removed takes the wallet credit back out', async () => {
    const student = await studentRepo.save(makeStudent());
    const { payment } = await payThenRemoveBill(student.id, '11111111-1111-4111-8111-111111111201');
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(1000);

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong bill');

    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
  });

  it('MON-03: the reversal audit lists each removed-bill wallet debit', async () => {
    const student = await studentRepo.save(makeStudent());
    const { payment } = await payThenRemoveBill(student.id, '11111111-1111-4111-8111-111111111203');

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong bill');

    const audit = await auditLogRepo.find({
      where: { entity_type: 'Payment', entity_id: payment.id },
    });
    const debits = audit
      .map(
        (a) =>
          (a.new_values as { removed_bill_wallet_debits?: Array<Record<string, unknown>> })
            ?.removed_bill_wallet_debits,
      )
      .find((d) => d !== undefined);
    expect(debits).toHaveLength(1);
    expect(debits![0]).toMatchObject({ student_id: student.id, amount: 1000 });
  });

  it('MON-03: removing a paid bill still credits the wallet of a student who has left', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 700 }));
    await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111204',
        lines: [{ student_fee_id: bill.id, amount: 700, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    await studentRepo.softDelete({ id: student.id });

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(StudentFee).softDelete({ id: bill.id });
      const removed = await manager
        .getRepository(StudentFee)
        .find({ where: { id: bill.id }, withDeleted: true });
      await returnMoneyOfRemovedBills(manager, walletService, removed, TENANT_ID, ACTOR_USER_ID);
    });

    expect(await walletService.balance(student.id, TENANT_ID)).toBe(700);
  });

  // Review r1 #3: unwinding money must work for a student who has left.
  it('reverses a plain cash payment of a student who has left, and creates no wallet', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111301',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    await studentRepo.softDelete({ id: student.id });

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'left');

    const original = await paymentRepo.findOneByOrFail({ id: payment.id });
    expect(original.reversed_by_payment_id).not.toBeNull();
    expect(await dataSource.getRepository(StudentWallet).count()).toBe(0);
  });

  it('MON-03: takes a removed-bill credit back even when its owner has left', async () => {
    const student = await studentRepo.save(makeStudent());
    const { payment } = await payThenRemoveBill(student.id, '11111111-1111-4111-8111-111111111302');
    await studentRepo.softDelete({ id: student.id });

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'left');

    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
  });

  // Review r1 #4: a FAILED payment never collected money, so a removed bill
  // must not turn its allocation into wallet credit.
  it('MON-03: a removed bill credits nothing for an allocation of a FAILED payment', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
    const failed = await paymentRepo.save(
      paymentRepo.create({
        student_id: student.id,
        total_amount: 1000,
        payment_method: PaymentMethod.BKASH,
        payment_status: PaymentStatus.FAILED,
        payment_date: new Date(),
        tenant_id: TENANT_ID,
      }),
    );
    await allocationRepo.save(
      allocationRepo.create({
        payment_id: failed.id,
        student_fee_id: bill.id,
        allocated_amount: 1000,
        allocation_type: PaymentAllocationType.DUE,
      }),
    );

    const credits = await dataSource.transaction(async (manager) => {
      await manager.getRepository(StudentFee).softDelete({ id: bill.id });
      const removed = await manager
        .getRepository(StudentFee)
        .find({ where: { id: bill.id }, withDeleted: true });
      return returnMoneyOfRemovedBills(manager, walletService, removed, TENANT_ID, ACTOR_USER_ID);
    });

    expect(credits).toEqual([]);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
  });

  // Review r1 #7: an invoice minted between the reversal's first read and its
  // row lock must still be cancelled.
  it('MON-05: cancels an invoice that was minted after the reversal first read the payment', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111303',
        lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    // The first read sees no invoice yet (stale), the DB has a live one.
    const realFindOne = paymentRepo.findOne.bind(paymentRepo);
    const spy = vi.spyOn(paymentRepo, 'findOne').mockImplementationOnce(async (opts) => {
      const p = await realFindOne(opts);
      return p ? Object.assign(p, { invoice_id: null }) : p;
    });

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'race');
    spy.mockRestore();

    const invoice = await invoiceRepo.findOneByOrFail({
      payment_id: payment.id,
      kind: InvoiceKind.INVOICE,
    });
    expect(invoice.status).toBe(InvoiceStatus.CANCELLED);
  });

  it('MON-03: refuses (409 naming the later payment) when the removed-bill credit was already spent', async () => {
    const student = await studentRepo.save(makeStudent());
    const { payment } = await payThenRemoveBill(student.id, '11111111-1111-4111-8111-111111111202');
    const billLater = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 1000, occurrence: 2 }),
    );
    const { payment: later } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111203',
        lines: [{ student_fee_id: billLater.id, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        wallet_use: 1000,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const err = await service
      .reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'too late')
      .catch((e) => e);
    expect(err).toBeInstanceOf(ReverseLaterPaymentsFirstException);
    expect(JSON.stringify(err.getResponse())).toContain(later.id);
  });

  it('MON-03: multi-student payment: reversal debits the credit from the wallet of the student whose bill was removed', async () => {
    const studentA = await studentRepo.save(makeStudent());
    const studentB = await studentRepo.save(makeStudent());
    const billA = await studentFeeRepo.save(
      makeBill(studentA.id, { total_amount: 1000, paid_amount: 1000, status: FeeStatus.PAID }),
    );
    const billB = await studentFeeRepo.save(
      makeBill(studentB.id, { total_amount: 1000, paid_amount: 1000, status: FeeStatus.PAID }),
    );
    // One payment (A is the payer) covering both students' bills.
    const payment = await paymentRepo.save(
      paymentRepo.create({
        tenant_id: TENANT_ID,
        student_id: studentA.id,
        total_amount: 2000,
        payment_method: PaymentMethod.CASH,
        received_by_user_id: ACTOR_USER_ID,
        payment_date: new Date(),
      }),
    );
    await allocationRepo.save([
      allocationRepo.create({
        payment_id: payment.id,
        student_fee_id: billA.id,
        allocated_amount: 1000,
        allocation_type: PaymentAllocationType.CURRENT,
      }),
      allocationRepo.create({
        payment_id: payment.id,
        student_fee_id: billB.id,
        allocated_amount: 1000,
        allocation_type: PaymentAllocationType.CURRENT,
      }),
    ]);
    // B's bill is removed: the credit lands in B's wallet, not A's.
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(StudentFee).softDelete({ id: billB.id });
      const removed = await manager
        .getRepository(StudentFee)
        .find({ where: { id: billB.id }, withDeleted: true });
      await returnMoneyOfRemovedBills(manager, walletService, removed, TENANT_ID, ACTOR_USER_ID);
    });
    expect(await walletService.balance(studentB.id, TENANT_ID)).toBe(1000);
    expect(await walletService.balance(studentA.id, TENANT_ID)).toBe(0);

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong');

    expect(await walletService.balance(studentB.id, TENANT_ID)).toBe(0);
    expect(await walletService.balance(studentA.id, TENANT_ID)).toBe(0);
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

  it('MON-14: reversing a payment whose wallet change fee generation auto-spent undoes that spend and re-opens the bill', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill1 = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 500, occurrence: 1 }),
    );
    const nextBill = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 200, occurrence: 2 }),
    );
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111120',
        lines: [{ student_fee_id: bill1.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 700,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    // What FeeGenerationService does for the next month's bill.
    await dataSource.transaction(async (m) => {
      await walletService.debit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 200,
          kind: WalletTransactionKind.DEBIT_GENERATION,
          studentFeeId: nextBill.id,
          createdByUserId: ACTOR_USER_ID,
        },
        m,
      );
      await m
        .getRepository(StudentFee)
        .update(nextBill.id, { paid_amount: 200, status: FeeStatus.PAID });
    });
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong amount');

    const reopened = await studentFeeRepo.findOneByOrFail({ id: nextBill.id });
    expect(reopened.status).toBe(FeeStatus.PENDING);
    expect(Number(reopened.paid_amount)).toBe(0);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
    const logs = await auditLogRepo.find({
      where: { entity_type: 'Payment', entity_id: payment.id, tenant_id: TENANT_ID },
    });
    const nv = logs.map((l) => l.new_values as any).find((v) => v?.reopened_bill_ids?.length);
    expect(nv.reopened_bill_ids).toEqual([nextBill.id]);
    expect(nv.undone_generation_debits).toHaveLength(1);

    // A second reversal of the same payment is refused.
    await expect(
      service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'again'),
    ).rejects.toThrow(ConflictException);
  });

  it('F-152 (#2647): a generation debit that points at a bill the payment allocated leaves paid_amount and the wallet consistent', async () => {
    // Hand-built overlap: the payment allocates to bill B AND a later
    // generation debit points at B (700 total = 500 by P + 200 by wallet).
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 700, occurrence: 1 }),
    );
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '2647f152-0000-4000-8000-000000000001',
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 700,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    await dataSource.transaction(async (m) => {
      await walletService.debit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 200,
          kind: WalletTransactionKind.DEBIT_GENERATION,
          studentFeeId: bill.id,
          createdByUserId: ACTOR_USER_ID,
        },
        m,
      );
      await m
        .getRepository(StudentFee)
        .update(bill.id, { paid_amount: 700, status: FeeStatus.PAID });
    });

    await service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'f-152');

    const after = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    // Both P's 500 and the 200 generation spend are undone: nothing left paid.
    expect(Number(after.paid_amount)).toBe(0);
    expect(after.status).toBe(FeeStatus.PENDING);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
    // The audit's "before" is the bill as it stood before the reversal (700 PAID),
    // not the value the generation-debit undo wrote a moment earlier (500 PARTIALLY_PAID).
    const logs = await auditLogRepo.find({
      where: { entity_type: 'Payment', entity_id: payment.id, tenant_id: TENANT_ID },
    });
    const old = logs.find((l) => l.action === AuditAction.UPDATE)?.old_values as any;
    expect(old.bills[0]).toMatchObject({
      student_fee_id: bill.id,
      paid_amount: 700,
      status: FeeStatus.PAID,
    });
  });

  /** Overpays `change` into the wallet on a fresh 500 bill; returns the payment. */
  async function payWithChange(studentId: string, occurrence: number, change: number, key: string) {
    const bill = await studentFeeRepo.save(makeBill(studentId, { total_amount: 500, occurrence }));
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 500 + change,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    return payment;
  }

  /** What FeeGenerationService does: wallet pays `amount` of a new bill. */
  async function generationSpend(studentId: string, occurrence: number, amount: number) {
    const bill = await studentFeeRepo.save(
      makeBill(studentId, { total_amount: amount, occurrence }),
    );
    await dataSource.transaction(async (m) => {
      await walletService.debit(
        {
          studentId,
          tenantId: TENANT_ID,
          amount,
          kind: WalletTransactionKind.DEBIT_GENERATION,
          studentFeeId: bill.id,
          createdByUserId: ACTOR_USER_ID,
        },
        m,
      );
      await m
        .getRepository(StudentFee)
        .update(bill.id, { paid_amount: amount, status: FeeStatus.PAID });
    });
    return bill;
  }

  it('MON-14: with several generation debits, only the oldest needed ones are undone', async () => {
    const student = await studentRepo.save(makeStudent());
    const a = await payWithChange(student.id, 1, 200, '11111111-1111-4111-8111-111111111130');
    const old1 = await generationSpend(student.id, 2, 100);
    const old2 = await generationSpend(student.id, 3, 100);
    // A later overpayment leaves 100 in the wallet, so reversing A is short by 100 only.
    await payWithChange(student.id, 4, 100, '11111111-1111-4111-8111-111111111131');
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(100);

    await service.reverse(a.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong');

    expect((await studentFeeRepo.findOneByOrFail({ id: old1.id })).status).toBe(FeeStatus.PENDING);
    // The newer debit is left alone.
    expect((await studentFeeRepo.findOneByOrFail({ id: old2.id })).status).toBe(FeeStatus.PAID);
    // 100 (later overpay) + 100 (undone debit) - 200 (A's change withdrawn).
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
    const logs = await auditLogRepo.find({
      where: { entity_type: 'Payment', entity_id: a.id, tenant_id: TENANT_ID },
    });
    const nv = logs.map((l) => l.new_values as any).find((v) => v?.reopened_bill_ids?.length);
    expect(nv.undone_generation_debits).toHaveLength(1);
    expect(nv.undone_generation_debits[0]).toMatchObject({
      amount: 100,
      student_fee_id: old1.id,
      paid_amount_before: 100,
      paid_amount_after: 0,
      status_before: FeeStatus.PAID,
      status_after: FeeStatus.PENDING,
    });
  });

  it('MON-14: a debit larger than the shortfall is undone whole (over-undo is deliberate)', async () => {
    const student = await studentRepo.save(makeStudent());
    const a = await payWithChange(student.id, 1, 100, '11111111-1111-4111-8111-111111111132');
    await payWithChange(student.id, 2, 100, '11111111-1111-4111-8111-111111111133');
    const spent = await generationSpend(student.id, 3, 200);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);

    await service.reverse(a.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong');

    // Shortfall was 100, but the whole 200 debit is undone: 200 back, 100 withdrawn.
    expect((await studentFeeRepo.findOneByOrFail({ id: spent.id })).status).toBe(FeeStatus.PENDING);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(100);
  });

  // A bills-first transaction (checkout, generation) locks its bills in one
  // `ORDER BY id` pass. The reversal must do the same with ALL its bills (the
  // payment's and the generation-paid ones), or the two can deadlock (40P01).
  it('MON-14: locks the payment bill and the generation bill in one sorted batch (no deadlock)', async () => {
    const student = await studentRepo.save(makeStudent());
    // Fixed ids so the generation bill sorts BEFORE the paid bill.
    const genId = '00000000-0000-4000-8000-0000000000a1';
    const paidId = 'ffffffff-ffff-4fff-8fff-0000000000a2';
    await studentFeeRepo.save(makeBill(student.id, { id: paidId, total_amount: 500 }));
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111140',
        lines: [{ student_fee_id: paidId, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 600,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    await studentFeeRepo.save(
      makeBill(student.id, { id: genId, total_amount: 100, occurrence: 2 }),
    );
    await dataSource.transaction(async (m) => {
      await walletService.debit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 100,
          kind: WalletTransactionKind.DEBIT_GENERATION,
          studentFeeId: genId,
          createdByUserId: ACTOR_USER_ID,
        },
        m,
      );
      await m.getRepository(StudentFee).update(genId, { paid_amount: 100, status: FeeStatus.PAID });
    });

    // Another transaction holds the lower bill, as a bills-first writer would.
    const other = dataSource.createQueryRunner();
    await other.connect();
    await other.startTransaction();
    try {
      await other.query('SELECT id FROM student_fees WHERE id = $1 FOR UPDATE', [genId]);
      const reversal = service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'x');
      reversal.catch(() => undefined);
      // Wait until the reversal is blocked on a row lock.
      for (let i = 0; i < 50; i += 1) {
        const [{ n }] = await dataSource.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (n > 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Now it takes the higher bill. With two separate lock batches the
      // reversal would already hold it and Postgres would abort one side.
      await other.query('SELECT id FROM student_fees WHERE id = $1 FOR UPDATE', [paidId]);
      await other.commitTransaction();
      await reversal;
    } finally {
      if (other.isTransactionActive) await other.rollbackTransaction();
      await other.release();
    }
    expect((await studentFeeRepo.findOneByOrFail({ id: genId })).status).toBe(FeeStatus.PENDING);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
  });

  it('MON-14: another tenant cannot reverse it and nothing is undone', async () => {
    const student = await studentRepo.save(makeStudent());
    const a = await payWithChange(student.id, 1, 200, '11111111-1111-4111-8111-111111111134');
    const spent = await generationSpend(student.id, 2, 200);

    await expect(
      service.reverse(a.id, OTHER_TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'wrong tenant'),
    ).rejects.toThrow(NotFoundException);

    expect((await studentFeeRepo.findOneByOrFail({ id: spent.id })).status).toBe(FeeStatus.PAID);
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
  });

  it('a back-dated later payment that spent the wallet change still blocks the reversal', async () => {
    const student = await studentRepo.save(makeStudent());
    const a = await payWithChange(student.id, 1, 200, '11111111-1111-4111-8111-111111111135');
    const billLater = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 300, occurrence: 2 }),
    );
    const { payment: later } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111136',
        lines: [{ student_fee_id: billLater.id, amount: 300, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        wallet_use: 200,
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    // As if it had been recorded with an earlier payment_date (MON-11 back-dating).
    await paymentRepo.update(later.id, { payment_date: daysFromToday(-2) });

    await expect(
      service.reverse(a.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'blocked'),
    ).rejects.toThrow(ReverseLaterPaymentsFirstException);
  });

  it('MON-14: still 409s when the generation debits cannot cover the shortfall', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill1 = await studentFeeRepo.save(
      makeBill(student.id, { total_amount: 500, occurrence: 1 }),
    );
    const { payment } = await checkoutService.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111121',
        lines: [{ student_fee_id: bill1.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 700,
        change_handling: 'TO_WALLET',
      } as any,
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    // An unrelated non-generation debit empties the wallet.
    await dataSource.transaction((m) =>
      walletService.debit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 200,
          kind: WalletTransactionKind.REVERSAL,
          createdByUserId: ACTOR_USER_ID,
        },
        m,
      ),
    );
    await expect(
      service.reverse(payment.id, TENANT_ID, ACTOR_USER_ID, APPROVER_USER_ID, 'x'),
    ).rejects.toMatchObject({ response: { code: 'REVERSE_BLOCKED_BY_NON_PAYMENT_WALLET_SPEND' } });
    expect(await walletService.balance(student.id, TENANT_ID)).toBe(0);
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
