import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../attention/engine/attention-events';
import { getQueueToken } from '@nestjs/bullmq';
import { FEE_NOTIFY_QUEUE } from '../communications/communications.constants';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { APPROVAL_TOKEN_AUDIENCE } from '../auth/jwt-secrets';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SchoolsService } from '../schools/schools.service';
import { StorageModule } from '../storage/storage.module';
import { ApprovalRequiredException } from '../../common/errors/approval-required.exception';
import { ApprovalService } from '../auth/guards/approval.guard';
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
  ApprovalScope,
  PaymentAllocationType,
  PaymentStatus,
  AuditAction,
} from '@biddaloy/shared';

/**
 * Integration tests for CheckoutService (16.4.2) — `POST /payments/checkout`'s
 * write path: multi-student allocation, one-off discounts behind approval,
 * wallet use, tendered/change, idempotency, and per-bill locking.
 */

const JWT_SECRET = 'test-checkout-secret';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000006590';
const ACTOR_USER_ID = SEED_ADMIN_USER_ID;
const TENANT_ID = SEED_TENANT_ID;

let studentSeq = 0;

function daysFromToday(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const feeNotifyAdd = vi.fn().mockResolvedValue(undefined);
/** The school's `region.timezone`, as `SchoolsService.getResolvedSettings` returns it. */
let schoolTz = 'Asia/Dhaka';
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

describe('CheckoutService (integration)', () => {
  let service: CheckoutService;
  let walletService: WalletService;
  let invoicesService: InvoicesService;
  let redis: Redis;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let paymentRepo: Repository<Payment>;
  let allocationRepo: Repository<PaymentAllocation>;
  let auditLogRepo: Repository<AuditLog>;
  let walletTxRepo: Repository<WalletTransaction>;
  let feeStructureRepo: Repository<FeeStructure>;
  let dataSource: DataSource;
  let feeStructureId: string;

  function makeStudent() {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Checkout Student ${studentSeq}`,
      registration_number: `REG-CHKS-${String(studentSeq).padStart(4, '0')}`,
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

  async function issueApprovalToken(
    jti: string,
    scope: ApprovalScope = ApprovalScope.FEES_DISCOUNT,
  ): Promise<string> {
    await redis.set(`approval:${jti}`, '1', 'EX', 300);
    const jwtService = new JwtService({ secret: JWT_SECRET });
    return jwtService.signAsync(
      {
        typ: 'approval',
        sub: ACTOR_USER_ID,
        act: ACTOR_USER_ID,
        tid: TENANT_ID,
        scope,
        jti,
      },
      { expiresIn: 300, audience: APPROVAL_TOKEN_AUDIENCE },
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
        CheckoutService,
        { provide: getQueueToken(FEE_NOTIFY_QUEUE), useValue: { add: feeNotifyAdd } },
        {
          provide: SchoolsService,
          useValue: { getResolvedSettings: async () => ({ region: { timezone: schoolTz } }) },
        },
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

    service = module.get<CheckoutService>(CheckoutService);
    walletService = module.get<WalletService>(WalletService);
    invoicesService = module.get<InvoicesService>(InvoicesService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    studentFeeRepo = module.get<Repository<StudentFee>>(getRepositoryToken(StudentFee));
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    allocationRepo = module.get<Repository<PaymentAllocation>>(
      getRepositoryToken(PaymentAllocation),
    );
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    walletTxRepo = module.get<Repository<WalletTransaction>>(getRepositoryToken(WalletTransaction));
    feeStructureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    dataSource = module.get(DataSource);

    await dataSource.query('DELETE FROM schools');
    const schoolRepo = dataSource.getRepository(School);
    const userRepo = dataSource.getRepository(User);
    const ayRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_ID, name: 'Test School', slug: 'test-checkout' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-checkout' }),
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
    await dataSource.query('DELETE FROM students WHERE tenant_id IN ($1, $2)', [
      TENANT_ID,
      OTHER_TENANT_ID,
    ]);

    const structure = await feeStructureRepo.save(
      feeStructureRepo.create({
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    feeStructureId = structure.id;
  });

  it('a committed checkout enqueues one receipt job and rechecks the fee alerts', async () => {
    feeNotifyAdd.mockClear();
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const dto = {
      idempotency_key: '33333333-3333-4333-8333-333333333333',
      lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
      change_handling: 'RETURN',
    } as any;

    let paymentId = '';
    const rechecks = await captureRechecks(async () => {
      const r = await service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken());
      paymentId = r.payment.id;
    });

    expect(feeNotifyAdd).toHaveBeenCalledTimes(1);
    expect(feeNotifyAdd).toHaveBeenCalledWith(
      'payments.recorded',
      expect.objectContaining({ payment_id: paymentId, tenant_id: TENANT_ID }),
      { jobId: `payments.recorded-${paymentId}` },
    );
    expect(rechecks).toEqual(
      [`${TENANT_ID}:fees.due_soon`, `${TENANT_ID}:fees.overdue_family`].sort(),
    );
  });

  it('records one payment across two students, three lines, one invoice with grouped lines', async () => {
    const studentA = await studentRepo.save(makeStudent());
    const studentB = await studentRepo.save(makeStudent());
    const billA1 = await studentFeeRepo.save(makeBill(studentA.id, { total_amount: 300 }));
    const billA2 = await studentFeeRepo.save(
      makeBill(studentA.id, { total_amount: 200, period_start: daysFromToday(-30) }),
    );
    const billB1 = await studentFeeRepo.save(makeBill(studentB.id, { total_amount: 400 }));

    const result = await service.checkout(
      {
        idempotency_key: '11111111-1111-4111-8111-111111111111',
        lines: [
          { student_fee_id: billA1.id, amount: 300, one_off_discount: 0 },
          { student_fee_id: billA2.id, amount: 200, one_off_discount: 0 },
          { student_fee_id: billB1.id, amount: 400, one_off_discount: 0 },
        ],
        payment_method: PaymentMethod.CASH,
        change_handling: 'RETURN',
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    expect(Number(result.payment.total_amount)).toBe(900);
    expect(result.invoice_id).toBeTruthy();

    const allocations = await allocationRepo.find({ where: { payment_id: result.payment.id } });
    expect(allocations).toHaveLength(3);

    const updatedA1 = await studentFeeRepo.findOneByOrFail({ id: billA1.id });
    const updatedA2 = await studentFeeRepo.findOneByOrFail({ id: billA2.id });
    const updatedB1 = await studentFeeRepo.findOneByOrFail({ id: billB1.id });
    expect(updatedA1.status).toBe(FeeStatus.PAID);
    expect(updatedA2.status).toBe(FeeStatus.PAID);
    expect(updatedB1.status).toBe(FeeStatus.PAID);
  });

  it('leaves a bill PARTIALLY_PAID when the line amount is less than the balance', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

    await service.checkout(
      {
        idempotency_key: '22222222-2222-4222-8222-222222222222',
        lines: [{ student_fee_id: bill.id, amount: 400, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    const updated = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(updated.status).toBe(FeeStatus.PARTIALLY_PAID);
    expect(Number(updated.paid_amount)).toBe(400);
  });

  it('rejects a one-off discount without an approval token (nothing written)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

    await expect(
      service.checkout(
        {
          idempotency_key: '33333333-3333-4333-8333-333333333333',
          lines: [{ student_fee_id: bill.id, amount: 900, one_off_discount: 100 }],
          payment_method: PaymentMethod.CASH,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow();

    const unchanged = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(Number(unchanged.paid_amount)).toBe(0);
    const payments = await paymentRepo.find({ where: { tenant_id: TENANT_ID } });
    expect(payments).toHaveLength(0);
  });

  it('settles the bill fully with a token, stamping the approver on the audit row', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
    const token = await issueApprovalToken('jti-checkout-discount-1');

    const result = await service.checkout(
      {
        idempotency_key: '44444444-4444-4444-8444-444444444444',
        lines: [{ student_fee_id: bill.id, amount: 900, one_off_discount: 100 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(token),
    );

    expect(result.payment.approved_by_user_id).toBe(ACTOR_USER_ID);
    const updated = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(updated.status).toBe(FeeStatus.PAID);

    const auditRows = await auditLogRepo.find({ where: { entity_id: result.payment.id } });
    expect(auditRows).toHaveLength(1);
    expect((auditRows[0].new_values as any).approved_by_user_id).toBe(ACTOR_USER_ID);
  });

  describe('MON-11 payment_date bounds', () => {
    const dayStr = (offset: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
        new Date(Date.now() + offset * 86_400_000),
      );
    async function attempt(offset: number, key: string, token?: string) {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id));
      const run = () =>
        service.checkout(
          {
            idempotency_key: key,
            lines: [{ student_fee_id: bill.id, amount: 1000 }],
            payment_method: PaymentMethod.CASH,
            payment_date: dayStr(offset),
          } as any,
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        );
      return { run, bill };
    }

    it('rejects tomorrow (400)', async () => {
      const { run } = await attempt(1, '55555555-5555-4555-8555-555555555501');
      await expect(run()).rejects.toThrow('cannot be in the future');
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
    });

    it('rejects 4 days back (400)', async () => {
      const { run } = await attempt(-4, '55555555-5555-4555-8555-555555555502');
      await expect(run()).rejects.toThrow('at most 3 days back');
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
    });

    it('accepts today without an approval', async () => {
      const { run } = await attempt(0, '55555555-5555-4555-8555-555555555503');
      const r = await run();
      expect(r.payment.approved_by_user_id).toBeNull();
    });

    it('2 days back without a token is refused and writes nothing', async () => {
      const { run, bill } = await attempt(-2, '55555555-5555-4555-8555-555555555504');
      await expect(run()).rejects.toBeInstanceOf(ApprovalRequiredException);
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
      expect(Number((await studentFeeRepo.findOneByOrFail({ id: bill.id })).paid_amount)).toBe(0);
    });

    it('a token for another scope does not unlock a backdate', async () => {
      const token = await issueApprovalToken('jti-bd-wrong', ApprovalScope.FEES_DISCOUNT);
      const { run } = await attempt(-2, '55555555-5555-4555-8555-555555555505', token);
      await expect(run()).rejects.toBeInstanceOf(ApprovalRequiredException);
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
    });

    it('exactly 3 days back is accepted with a backdate token', async () => {
      const token = await issueApprovalToken('jti-bd-3', ApprovalScope.PAYMENTS_BACKDATE);
      const { run } = await attempt(-3, '55555555-5555-4555-8555-555555555507', token);
      const r = await run();
      expect(r.payment.payment_date.toISOString().slice(0, 10)).toBe(dayStr(-3));
    });

    it('a back-dated checkout with a one-off discount is refused (400) before any token is spent', async () => {
      const token = await issueApprovalToken('jti-bd-disc', ApprovalScope.PAYMENTS_BACKDATE);
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id));
      await expect(
        service.checkout(
          {
            idempotency_key: '55555555-5555-4555-8555-555555555508',
            lines: [{ student_fee_id: bill.id, amount: 900, one_off_discount: 100 }],
            payment_method: PaymentMethod.CASH,
            payment_date: dayStr(-1),
          } as any,
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        ),
      ).rejects.toThrow('cannot carry a one-off discount');
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
      // The token was not burned.
      expect(await redis.get('approval:jti-bd-disc')).toBe('1');
    });

    // [#2295] "Today" is the school's own date, not Dhaka's. At 12:00 UTC it is
    // already tomorrow in Kiritimati (UTC+14) but still today in Dhaka.
    it("uses the school's own time zone: Kiritimati's today is accepted without a token", async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
      schoolTz = 'Pacific/Kiritimati';
      try {
        const student = await studentRepo.save(makeStudent());
        const bill = await studentFeeRepo.save(makeBill(student.id));
        const r = await service.checkout(
          {
            idempotency_key: '55555555-5555-4555-8555-555555555509',
            lines: [{ student_fee_id: bill.id, amount: 1000 }],
            payment_method: PaymentMethod.CASH,
            payment_date: '2026-10-13',
          } as any,
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        );
        expect(r.payment.approved_by_user_id).toBeNull();
      } finally {
        schoolTz = 'Asia/Dhaka';
        vi.useRealTimers();
      }
    });

    it('2 days back with a payments.backdate token stores that day and audits it', async () => {
      const token = await issueApprovalToken('jti-bd-ok', ApprovalScope.PAYMENTS_BACKDATE);
      const { run } = await attempt(-2, '55555555-5555-4555-8555-555555555506', token);
      const r = await run();
      expect(r.payment.payment_date.toISOString().slice(0, 10)).toBe(dayStr(-2));
      expect(r.payment.approved_by_user_id).toBe(ACTOR_USER_ID);
      const rows = await auditLogRepo.find({ where: { entity_id: r.payment.id } });
      expect(rows).toHaveLength(1);
      const nv = rows[0].new_values as any;
      expect(nv.backdated_to).toBe(dayStr(-2));
      expect(nv.approval_scope).toBe(ApprovalScope.PAYMENTS_BACKDATE);
    });
  });

  it('tendered 5000 for a 4950 total returns change of 50 (RETURN) / credits wallet 50 (TO_WALLET)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 4950 }));

    const returned = await service.checkout(
      {
        idempotency_key: '55555555-5555-4555-8555-555555555555',
        lines: [{ student_fee_id: bill.id, amount: 4950, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 5000,
        change_handling: 'RETURN',
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    expect(returned.change_amount).toBe(50);

    const student2 = await studentRepo.save(makeStudent());
    const bill2 = await studentFeeRepo.save(makeBill(student2.id, { total_amount: 4950 }));
    const toWallet = await service.checkout(
      {
        idempotency_key: '66666666-6666-4666-8666-666666666666',
        lines: [{ student_fee_id: bill2.id, amount: 4950, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        tendered_amount: 5000,
        change_handling: 'TO_WALLET',
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    expect(toWallet.wallet_balance_after).toBe(50);
  });

  describe('whole-paisa money checks (#2636)', () => {
    const run = (billId: string, key: string, over: Record<string, unknown>, amount = 1000) =>
      service.checkout(
        {
          idempotency_key: key,
          lines: [{ student_fee_id: billId, amount, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
          ...over,
        } as any,
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );

    it('a line of balance + 0.01 is a 400 and writes nothing; exactly the balance succeeds', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

      await expect(
        run(bill.id, '2636a001-0000-4000-8000-000000000001', {}, 1000.01),
      ).rejects.toThrow(BadRequestException);
      expect(
        await paymentRepo.count({ where: { tenant_id: TENANT_ID, student_id: student.id } }),
      ).toBe(0);

      await run(bill.id, '2636a001-0000-4000-8000-000000000002', {}, 1000);
      const after = await studentFeeRepo.findOneByOrFail({ id: bill.id });
      expect(Number(after.paid_amount)).toBe(1000);
    });

    it('a card tender above the amount due is a 400; the same tender in cash gives change', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

      await expect(
        run(bill.id, '2636a002-0000-4000-8000-000000000001', {
          payment_method: PaymentMethod.CARD,
          tendered_amount: 1100,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(
        await paymentRepo.count({ where: { tenant_id: TENANT_ID, student_id: student.id } }),
      ).toBe(0);

      const ok = await run(bill.id, '2636a002-0000-4000-8000-000000000002', {
        tendered_amount: 1100,
      });
      expect(ok.change_amount).toBe(100);
    });

    it('cash change of 0.01 with TO_WALLET still writes the CREDIT_CHANGE row', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

      const r = await run(bill.id, '2636a003-0000-4000-8000-000000000001', {
        tendered_amount: 1000.01,
        change_handling: 'TO_WALLET',
      });
      expect(r.wallet_balance_after).toBe(0.01);
    });

    it('wallet_use of total + 0.01 is a 400', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
      await dataSource.transaction(async (manager) => {
        await walletService.credit(
          {
            studentId: student.id,
            tenantId: TENANT_ID,
            amount: 2000,
            kind: 'CREDIT_OVERPAYMENT' as any,
          },
          manager,
        );
      });

      await expect(
        run(bill.id, '2636a004-0000-4000-8000-000000000001', { wallet_use: 1000.01 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('draws down the wallet for wallet_use, recording a DEBIT_CHECKOUT transaction', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));

    await dataSource.transaction(async (manager) => {
      await walletService.credit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 200,
          kind: 'CREDIT_OVERPAYMENT' as any,
        },
        manager,
      );
    });

    const result = await service.checkout(
      {
        idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        wallet_use: 200,
        tendered_amount: 800,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    expect(result.wallet_balance_after).toBe(0);
    const debitTx = await walletTxRepo.find({ where: { payment_id: result.payment.id } });
    expect(debitTx.some((t) => t.kind === 'DEBIT_CHECKOUT' && Number(t.amount) === -200)).toBe(
      true,
    );
  });

  it('replays the same idempotency_key to the same payment instead of recording twice', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const key = '77777777-7777-4777-8777-777777777777';

    const first = await service.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );
    const second = await service.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

    expect(second.payment.id).toBe(first.payment.id);
    const payments = await paymentRepo.find({ where: { idempotency_key: key } });
    expect(payments).toHaveLength(1);
  });

  it('a replay of a PENDING payment is a 409 "not complete", never "reversed" (#2637)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const dto = {
      idempotency_key: '2637a003-0000-4000-8000-000000000001',
      lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
    };
    const first = await service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken());
    // Checkout only writes SUCCESS; a future gateway payment could sit at PENDING.
    await paymentRepo.update(first.payment.id, { payment_status: PaymentStatus.PENDING });

    const err = await service
      .checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      details: { code: 'CHECKOUT_PAYMENT_NOT_COMPLETE' },
    });
  });

  it('a replay without payment_date after a back-dated first request is a 400; a plain replay still replays (#2663)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 5 }));
    const body = {
      idempotency_key: '2663a001-0000-4000-8000-000000000001',
      lines: [{ student_fee_id: bill.id, amount: 5, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
      tendered_amount: 5,
      payment_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
        new Date(Date.now() - 2 * 86_400_000),
      ),
    };
    const token = await issueApprovalToken('jti-2663', ApprovalScope.PAYMENTS_BACKDATE);
    const first = await service.checkout(body, TENANT_ID, ACTOR_USER_ID, requestWithToken(token));
    const { payment_date: _omit, ...noDate } = body;
    await expect(
      service.checkout(noDate, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
    ).rejects.toThrow(BadRequestException);
    const again = await service.checkout(body, TENANT_ID, ACTOR_USER_ID, requestWithToken());
    expect(again.payment.id).toBe(first.payment.id);
  });

  it('a replay with a flipped change_handling or another payment_date is a 400 and writes nothing (#2637)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 5 }));
    const key = '2637a002-0000-4000-8000-000000000001';
    const body = {
      idempotency_key: key,
      lines: [{ student_fee_id: bill.id, amount: 5, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
      tendered_amount: 20,
      change_handling: 'RETURN' as const,
    };
    const first = await service.checkout(body, TENANT_ID, ACTOR_USER_ID, requestWithToken());

    // Same key, change would now go to the wallet: a different request.
    await expect(
      service.checkout(
        { ...body, change_handling: 'TO_WALLET' },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(BadRequestException);
    // Same key, explicit payment_date the first one did not carry.
    await expect(
      service.checkout(
        { ...body, payment_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(await paymentRepo.count({ where: { idempotency_key: key } })).toBe(1);
    // An identical replay still returns the stored payment.
    const again = await service.checkout(body, TENANT_ID, ACTOR_USER_ID, requestWithToken());
    expect(again.payment.id).toBe(first.payment.id);
  });

  // Business-critical: the replay is the client's recovery path. A bill removed
  // after the first request (MON-03) hides `student_fee` from the relation join;
  // the replay must still return the stored result and re-enqueue the receipt.
  it('replays to the stored result even when a paid bill was removed after the first request', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
    const dto = {
      idempotency_key: '77777777-7777-4777-8777-777777777778',
      lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
    };
    const first = await service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken());
    await studentFeeRepo.softDelete(bill.id);
    feeNotifyAdd.mockClear();

    const replay = await service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken());

    expect(replay.payment.id).toBe(first.payment.id);
    expect(feeNotifyAdd).toHaveBeenCalledWith(
      'payments.recorded',
      expect.objectContaining({ payment_id: first.payment.id, student_ids: [student.id] }),
      { jobId: `payments.recorded-${first.payment.id}` },
    );
  });

  // [#2295] DUE vs CURRENT uses the school's own date, the same one the
  // back-dating window uses. At 12:00 UTC it is 13 Oct in Kiritimati but 12 Oct
  // in Dhaka, so a bill due 12 Oct is already DUE for a Kiritimati school.
  it("tags a bill due yesterday in the school's time zone as DUE", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    schoolTz = 'Pacific/Kiritimati';
    try {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(
        makeBill(student.id, { due_date: new Date('2026-10-12T00:00:00Z') }),
      );
      const r = await service.checkout(
        {
          idempotency_key: '77777777-7777-4777-8777-777777777779',
          lines: [{ student_fee_id: bill.id, amount: 1000 }],
          payment_method: PaymentMethod.CASH,
        } as any,
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      );
      const [allocation] = await allocationRepo.find({ where: { payment_id: r.payment.id } });
      expect(allocation.allocation_type).toBe(PaymentAllocationType.DUE);
    } finally {
      schoolTz = 'Asia/Dhaka';
      vi.useRealTimers();
    }
  });

  let foreignSeq = 0;
  /** A bill that belongs to a student of OTHER_TENANT_ID (unique per call, D18). */
  async function makeForeignBill() {
    foreignSeq += 1;
    const saved = await studentRepo.save(
      studentRepo.create({
        full_name: `Other Tenant Student ${foreignSeq}`,
        registration_number: `REG-CHKS-OTHER-${String(foreignSeq).padStart(4, '0')}`,
        roll_number: 900 + foreignSeq,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: OTHER_TENANT_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: 'SMS' as any,
      }),
    );
    const otherStructure = await feeStructureRepo.save(
      feeStructureRepo.create({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `Other Tuition ${foreignSeq}`,
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    return studentFeeRepo.save(
      makeBill(saved.id, { fee_structure_id: otherStructure.id, total_amount: 1000 }),
    );
  }

  const checkoutBill = (billId: string, key: string) =>
    service.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: billId, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

  it('rejects a student_fee_id from another tenant (404, same text as a missing id)', async () => {
    const bill = await makeForeignBill();

    await expect(checkoutBill(bill.id, '88888888-8888-4888-8888-888888888888')).rejects.toThrow(
      new NotFoundException('Student fee not found'),
    );
    // Nothing was written to the foreign bill.
    const after = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(Number(after.paid_amount)).toBe(0);
  });

  it('a random id and a soft-deleted student give the SAME 404 text, with no id in it (#2640)', async () => {
    const randomId = '2640a001-0000-4000-8000-0000000000ff';
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
    await studentRepo.softDelete(student.id);

    for (const [id, key] of [
      [randomId, '2640a001-0000-4000-8000-000000000001'],
      [bill.id, '2640a001-0000-4000-8000-000000000002'],
    ]) {
      const err = await checkoutBill(id, key).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Student fee not found');
      expect(err.message).not.toContain(id);
    }
  });

  it("does not lock or wait on another tenant's bill (#2640)", async () => {
    const bill = await makeForeignBill();
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // Another transaction holds the foreign row. A tenant-blind lock would block here forever.
      await qr.query('SELECT id FROM student_fees WHERE id = $1 FOR UPDATE', [bill.id]);
      await expect(checkoutBill(bill.id, '2640a002-0000-4000-8000-000000000001')).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  }, 5000);

  it('rejects a line amount that exceeds the bill balance', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    const error = await service
      .checkout(
        {
          idempotency_key: '99999999-9999-4999-8999-999999999999',
          lines: [{ student_fee_id: bill.id, amount: 600, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    // Rule 23: fixed text plus a code; neither the submitted 600 nor the 500 balance is echoed.
    const body = (error as BadRequestException).getResponse();
    expect(body).toMatchObject({
      message: 'The amount is more than the outstanding balance',
      details: { code: 'CHECKOUT_AMOUNT_EXCEEDS_BALANCE' },
    });
    expect(JSON.stringify(body)).not.toMatch(/600|500/);
  });

  it('rejects a WAIVED bill (409, no write)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(
      makeBill(student.id, {
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 1000,
        one_off_discount_amount: 1000,
        status: FeeStatus.WAIVED,
      }),
    );

    await expect(
      service.checkout(
        {
          idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(ConflictException);

    const unchanged = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(unchanged.status).toBe(FeeStatus.WAIVED);
    expect(Number(unchanged.paid_amount)).toBe(0);
  });

  const payFull = (billId: string, key: string, amount: number) =>
    service.checkout(
      {
        idempotency_key: key,
        lines: [{ student_fee_id: billId, amount, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      },
      TENANT_ID,
      ACTOR_USER_ID,
      requestWithToken(),
    );

  it('paying an already-paid bill with a new key is a 409, not a 404, and writes nothing (#2592)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 300 }));
    await payFull(bill.id, '2592a001-0000-4000-8000-000000000001', 300);

    await expect(payFull(bill.id, '2592a001-0000-4000-8000-000000000002', 300)).rejects.toThrow(
      ConflictException,
    );
    const payments = await paymentRepo.count({
      where: { tenant_id: TENANT_ID, student_id: student.id },
    });
    expect(payments).toBe(1);
    const after = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(after.status).toBe(FeeStatus.PAID);
    expect(Number(after.paid_amount)).toBe(300);
  });

  it('a bill id that matches no row is still a 404 (#2592)', async () => {
    await expect(
      payFull('2592a002-0000-4000-8000-0000000000ff', '2592a002-0000-4000-8000-000000000001', 100),
    ).rejects.toThrow(NotFoundException);
  });

  describe('wallet lock before approval token (#2647)', () => {
    const credit = (studentId: string, amount: number) =>
      dataSource.transaction((manager) =>
        walletService.credit(
          { studentId, tenantId: TENANT_ID, amount, kind: 'CREDIT_OVERPAYMENT' as any },
          manager,
        ),
      );

    it('a concurrent wallet spend fails the checkout on the balance and the approval token survives', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 1000 }));
      await credit(student.id, 500);
      const jti = 'jti-2647-wallet-lock';
      const token = await issueApprovalToken(jti);
      const body = (key: string, wallet: boolean) => ({
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 900, one_off_discount: 100 }],
        payment_method: PaymentMethod.CASH,
        ...(wallet ? { wallet_use: 500, tendered_amount: 400 } : {}),
      });

      // Second connection holds the wallet row and spends it all.
      const qr = dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      await walletService.debit(
        {
          studentId: student.id,
          tenantId: TENANT_ID,
          amount: 500,
          kind: 'DEBIT_CHECKOUT' as any,
        } as any,
        qr.manager,
      );

      const pending = service
        .checkout(
          body('2647a001-0000-4000-8000-000000000001', true),
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(token),
        )
        .then(
          () => null,
          (e) => e,
        );
      await expect
        .poll(async () => {
          const rows = await dataSource.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          );
          return rows[0].n;
        })
        .toBeGreaterThan(0);
      await qr.commitTransaction();
      await qr.release();

      expect(await pending).toBeInstanceOf(BadRequestException);
      expect(await redis.exists(`approval:${jti}`)).toBe(1);

      // Same token still pays the discounted checkout without wallet_use.
      const ok = await service.checkout(
        body('2647a001-0000-4000-8000-000000000002', false),
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(token),
      );
      expect(ok.payment.approved_by_user_id).toBe(ACTOR_USER_ID);
      expect(await redis.exists(`approval:${jti}`)).toBe(0);
    });

    it('TO_WALLET change across siblings is a 400 and writes nothing', async () => {
      const a = await studentRepo.save(makeStudent());
      const b = await studentRepo.save(makeStudent());
      const billA = await studentFeeRepo.save(makeBill(a.id, { total_amount: 500 }));
      const billB = await studentFeeRepo.save(makeBill(b.id, { total_amount: 500 }));

      await expect(
        service.checkout(
          {
            idempotency_key: '2647a002-0000-4000-8000-000000000001',
            lines: [
              { student_fee_id: billA.id, amount: 500, one_off_discount: 0 },
              { student_fee_id: billB.id, amount: 500, one_off_discount: 0 },
            ],
            payment_method: PaymentMethod.CASH,
            tendered_amount: 1200,
            change_handling: 'TO_WALLET',
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID, student_id: a.id } })).toBe(
        0,
      );
      expect(
        await dataSource.getRepository(StudentWallet).count({ where: { student_id: a.id } }),
      ).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('two concurrent checkouts against the same bill never overshoot its balance — one succeeds, the other gets a clean validation error', async () => {
      // 700 balance, two concurrent requests for 500 each (1000 total) —
      // whichever wins the row lock first sees the fresh balance and
      // succeeds; the other must see the already-reduced balance and
      // reject cleanly, never letting paid_amount exceed total_amount.
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 700 }));

      const results = await Promise.allSettled([
        service.checkout(
          {
            idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
            payment_method: PaymentMethod.CASH,
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
        service.checkout(
          {
            idempotency_key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
            payment_method: PaymentMethod.CASH,
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const updated = await studentFeeRepo.findOneByOrFail({ id: bill.id });
      expect(Number(updated.paid_amount)).toBeLessThanOrEqual(700);
      expect(Number(updated.paid_amount)).toBe(500);
    });

    it('two concurrent full-balance checkouts with different keys: one pays, one gets a 409 (#2592)', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 400 }));

      const results = await Promise.allSettled([
        payFull(bill.id, '2592a003-0000-4000-8000-000000000001', 400),
        payFull(bill.id, '2592a003-0000-4000-8000-000000000002', 400),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(
        await paymentRepo.count({ where: { tenant_id: TENANT_ID, student_id: student.id } }),
      ).toBe(1);
    });

    it('two simultaneous requests with one key and DIFFERENT bills: one pays, the other is a 400 (#2637)', async () => {
      const student = await studentRepo.save(makeStudent());
      const billA = await studentFeeRepo.save(makeBill(student.id, { total_amount: 300 }));
      const billB = await studentFeeRepo.save(
        makeBill(student.id, { total_amount: 300, period_start: daysFromToday(-30) }),
      );
      const key = '2637a003-0000-4000-8000-000000000001';
      const body = (billId: string) => ({
        idempotency_key: key,
        lines: [{ student_fee_id: billId, amount: 300, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      });

      const results = await Promise.allSettled([
        service.checkout(body(billA.id), TENANT_ID, ACTOR_USER_ID, requestWithToken()),
        service.checkout(body(billB.id), TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(await paymentRepo.count({ where: { idempotency_key: key } })).toBe(1);
    });

    it('two concurrent checkouts with the SAME idempotency key create exactly one payment and one invoice', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
      const key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

      const dto = {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      };

      const [a, b] = await Promise.all([
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ]);

      // Proves fix #1: the winner-found path inside the transaction
      // short-circuits instead of falling through to invoice creation —
      // without that fix this would create two invoices for one payment.
      // Note: the loser can resolve slightly before the winner's own
      // post-commit invoice creation finishes, so `invoice_id` isn't
      // compared directly on the two return values — the DB state
      // (queried after both promises have settled) is the source of truth.
      expect(a.payment.id).toBe(b.payment.id);
      const payments = await paymentRepo.find({ where: { idempotency_key: key } });
      expect(payments).toHaveLength(1);
      const invoices = await dataSource.getRepository(Invoice).find({
        where: { student_id: student.id },
      });
      expect(invoices).toHaveLength(1);
    });

    it('recovers an orphaned payment (invoice creation failed post-commit) on the next idempotent replay', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
      const key = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const dto = {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      };

      const createSpy = vi
        .spyOn(invoicesService, 'create')
        .mockRejectedValueOnce(new Error('simulated invoice-service outage'));
      feeNotifyAdd.mockClear();

      await expect(
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ).rejects.toThrow('simulated invoice-service outage');
      // The first request died before its after-commit work: no receipt yet.
      expect(feeNotifyAdd).not.toHaveBeenCalled();

      // The payment itself is durably committed even though the request
      // as a whole threw — this is the documented trade-off `checkout()`
      // makes deliberately (see its comment). Without the fix under test,
      // this row would be permanently invoice-less.
      const orphaned = await paymentRepo.findOneOrFail({ where: { idempotency_key: key } });
      expect(orphaned.invoice_id).toBeNull();

      createSpy.mockRestore();

      // The client retries with the same idempotency key, exactly as a
      // real caller would after a 500. This must now repair the orphan
      // instead of returning the same incomplete result forever.
      const retryMeta: { replayed?: boolean } = {};
      const retried = await service.checkout(
        dto,
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
        retryMeta,
      );

      expect(retryMeta.replayed).toBe(true);
      expect(retried.payment.id).toBe(orphaned.id);
      expect(retried.invoice_id).toBeTruthy();
      // [68.4.10] The sequential retry is what sends the guardian the receipt
      // the first request never enqueued (the jobId makes a repeat harmless).
      expect(feeNotifyAdd).toHaveBeenCalledWith(
        'payments.recorded',
        expect.objectContaining({ payment_id: orphaned.id, tenant_id: TENANT_ID }),
        { jobId: `payments.recorded-${orphaned.id}` },
      );

      const repaired = await paymentRepo.findOneOrFail({ where: { id: orphaned.id } });
      expect(repaired.invoice_id).toBeTruthy();

      const invoices = await dataSource.getRepository(Invoice).find({
        where: { student_id: student.id },
      });
      expect(invoices).toHaveLength(1);
    });

    it('does not mint two invoices when two replays race to repair the same orphaned payment', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
      const key = '99999999-9999-4999-8999-999999999999';
      const dto = {
        idempotency_key: key,
        lines: [{ student_fee_id: bill.id, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      };

      const createSpy = vi
        .spyOn(invoicesService, 'create')
        .mockRejectedValueOnce(new Error('simulated invoice-service outage'));
      await expect(
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ).rejects.toThrow('simulated invoice-service outage');
      createSpy.mockRestore();

      const [resultA, resultB] = await Promise.all([
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ]);

      // The repair lock is blocking, not try-and-give-up — both replays
      // wait for whichever of them actually repairs the payment, so
      // neither ever sees an empty invoice_id.
      expect(resultA.invoice_id).toBeTruthy();
      expect(resultB.invoice_id).toBeTruthy();
      expect(resultA.invoice_id).toBe(resultB.invoice_id);

      const payments = await paymentRepo.find({ where: { idempotency_key: key } });
      expect(payments).toHaveLength(1);
      expect(payments[0].invoice_id).toBeTruthy();

      const invoices = await dataSource.getRepository(Invoice).find({
        where: { student_id: student.id },
      });
      expect(invoices).toHaveLength(1);
    });
  });

  // [2649] Ported from the deleted `payment-allocation.service.integration.spec.ts`
  // (`recordWithAllocation`): the cases checkout had no twin for.
  describe('[2649] ported from recordWithAllocation', () => {
    const KEY = (n: number) => `00000000-0000-4000-8000-0000000026${String(n).padStart(2, '0')}`;
    const pay = (billId: string, amount: number, key: string, tenantId = TENANT_ID) =>
      service.checkout(
        {
          idempotency_key: key,
          lines: [{ student_fee_id: billId, amount }],
          payment_method: PaymentMethod.CASH,
        },
        tenantId,
        ACTOR_USER_ID,
        requestWithToken(),
      );

    it('freezes the school profile onto the payment and its invoice at record time', async () => {
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.update(TENANT_ID, { name: 'Payment-Time Name' });
      try {
        const student = await studentRepo.save(makeStudent());
        const bill = await studentFeeRepo.save(makeBill(student.id));

        const { payment, invoice_id } = await pay(bill.id, 1000, KEY(1));

        expect(payment.issuer_snapshot?.name).toBe('Payment-Time Name');
        const invoice = await dataSource.getRepository(Invoice).findOneByOrFail({ id: invoice_id });
        expect(invoice.issuer_snapshot?.name).toBe('Payment-Time Name');
      } finally {
        await schoolRepo.update(TENANT_ID, { name: 'Test School' });
      }
    });

    it('serializes with an in-flight profile update: a name committed before the insert is what gets frozen', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id));

      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.manager
          .createQueryBuilder(School, 'school')
          .setLock('pessimistic_write')
          .where('school.id = :id', { id: TENANT_ID })
          .getOne();
        await runner.manager.update(School, TENANT_ID, { name: 'Committed Before Insert' });

        const pending = pay(bill.id, 1000, KEY(2));
        await new Promise((resolve) => setTimeout(resolve, 200));
        await runner.commitTransaction();

        const { payment, invoice_id } = await pending;
        expect(payment.issuer_snapshot?.name).toBe('Committed Before Insert');
        const invoice = await dataSource.getRepository(Invoice).findOneByOrFail({ id: invoice_id });
        expect(invoice.issuer_snapshot?.name).toBe('Committed Before Insert');
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await dataSource.getRepository(School).update(TENANT_ID, { name: 'Test School' });
      }
    });

    it('assigns sequential invoice numbers across separate payments', async () => {
      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      const b1 = await studentFeeRepo.save(makeBill(s1.id));
      const b2 = await studentFeeRepo.save(makeBill(s2.id));

      const r1 = await pay(b1.id, 1000, KEY(3));
      const r2 = await pay(b2.id, 1000, KEY(4));

      const seq = (n: string) => parseInt(n.split('-')[2], 10);
      expect(seq(r2.invoice_number)).toBe(seq(r1.invoice_number) + 1);
    });

    it('writes one tenant-stamped PAYMENT_RECEIVED audit row', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id));

      const { payment, invoice_id } = await pay(bill.id, 400, KEY(5));

      const received = await auditLogRepo.find({
        where: { entity_id: payment.id, action: AuditAction.PAYMENT_RECEIVED },
      });
      expect(received).toHaveLength(1);
      expect(received[0].performed_by_user_id).toBe(ACTOR_USER_ID);
      expect(received[0].entity_type).toBe('Payment');
      expect(received[0].tenant_id).toBe(TENANT_ID);
      // Checkout writes no INVOICE_GENERATED row (only the deleted recordWithAllocation did).
      expect(invoice_id).toBeTruthy();
    });

    // #2700: the three cases from the deleted recordWithAllocation spec that had no checkout twin.
    it('rejects a duplicate student_fee_id in lines (400, nothing written)', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id));
      await expect(
        service.checkout(
          {
            idempotency_key: KEY(7),
            lines: [
              { student_fee_id: bill.id, amount: 100 },
              { student_fee_id: bill.id, amount: 100 },
            ],
            payment_method: PaymentMethod.CASH,
          },
          TENANT_ID,
          ACTOR_USER_ID,
          requestWithToken(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
    });

    it('refuses to pay a bill already fully covered by discount (nothing written)', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(
        makeBill(student.id, {
          total_amount: 1000,
          discount_amount: 1000,
          standing_discount_amount: 1000,
        }),
      );
      await expect(pay(bill.id, 100, KEY(8))).rejects.toThrow();
      expect(await paymentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
      expect(Number((await studentFeeRepo.findOneByOrFail({ id: bill.id })).paid_amount)).toBe(0);
    });

    it('two concurrent payments by different students get distinct invoice numbers', async () => {
      const s1 = await studentRepo.save(makeStudent());
      const s2 = await studentRepo.save(makeStudent());
      const b1 = await studentFeeRepo.save(makeBill(s1.id));
      const b2 = await studentFeeRepo.save(makeBill(s2.id));

      const [r1, r2] = await Promise.all([pay(b1.id, 1000, KEY(9)), pay(b2.id, 1000, KEY(10))]);

      expect(r1.invoice_number).toBeTruthy();
      expect(r2.invoice_number).not.toBe(r1.invoice_number);
    });

    it('allows the same idempotency key in two different tenants (two payments)', async () => {
      const student = await studentRepo.save(makeStudent());
      const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));
      const other = makeStudent();
      other.tenant_id = OTHER_TENANT_ID;
      const otherStudent = await studentRepo.save(other);
      const otherBill = await studentFeeRepo.save(makeBill(otherStudent.id, { total_amount: 500 }));

      const first = await pay(bill.id, 500, KEY(6));
      const second = await pay(otherBill.id, 500, KEY(6), OTHER_TENANT_ID);

      expect(second.payment.id).not.toBe(first.payment.id);
      expect(second.payment.tenant_id).toBe(OTHER_TENANT_ID);
    });
  });
});
