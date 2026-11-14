import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  AuditAction,
  FeeStatus,
  FeeType,
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
  PaymentMethod,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { FEE_NOTIFY_QUEUE } from '../communications/communications.constants';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SchoolsService } from '../schools/schools.service';
import { StorageModule } from '../storage/storage.module';
import { ApprovalService } from '../auth/guards/approval.guard';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { Student } from '../students/entities/student.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PaymentSubmission } from '../payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionEvent } from '../payment-submissions/entities/payment-submission-event.entity';
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
  PaymentSubmissionSettlement,
  settlementIdempotencyKey,
  SettlementMode,
} from './payment-submission-settlement.service';

const TENANT_ID = SEED_TENANT_ID;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000006591';
const ACTOR = SEED_ADMIN_USER_ID;
const JWT_SECRET = 'test-settlement-secret';

let seq = 0;
const days = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

describe('PaymentSubmissionSettlement (integration)', () => {
  let svc: PaymentSubmissionSettlement;
  let checkout: CheckoutService;
  let ds: DataSource;
  let redis: Redis;
  let studentRepo: Repository<Student>;
  let feeRepo: Repository<StudentFee>;
  let paymentRepo: Repository<Payment>;
  let subRepo: Repository<PaymentSubmission>;
  let subBillRepo: Repository<PaymentSubmissionBill>;
  let eventRepo: Repository<PaymentSubmissionEvent>;
  let walletTxRepo: Repository<WalletTransaction>;
  let auditRepo: Repository<AuditLog>;
  let structureId: string;

  const mkStudent = () => {
    seq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Settle Student ${seq}`,
        registration_number: `REG-SETL-${String(seq).padStart(4, '0')}`,
        roll_number: seq,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: TENANT_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: 'SMS' as any,
      }),
    );
  };
  const mkBill = (studentId: string, total = 1000, extra: Partial<StudentFee> = {}) =>
    feeRepo.save(
      feeRepo.create({
        student_id: studentId,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        fee_structure_id: structureId,
        period_start: days(-60),
        period_type: 'MONTH' as any,
        occurrence: 1,
        total_amount: total,
        paid_amount: 0,
        discount_amount: 0,
        standing_discount_amount: 0,
        one_off_discount_amount: 0,
        status: FeeStatus.PENDING,
        due_date: days(-10),
        ...extra,
      }),
    );

  /** One submission covering `bills` (each at its full total) of the given source. */
  async function mkSubmission(
    bills: StudentFee[],
    opts: {
      source?: PaymentSubmissionSource;
      status?: PaymentSubmissionStatus;
      amount?: number;
      tenantId?: string;
    } = {},
  ) {
    const source = opts.source ?? PaymentSubmissionSource.PROOF;
    seq += 1;
    const total = bills.reduce((n, b) => n + Number(b.total_amount), 0);
    const sub = await subRepo.save(
      subRepo.create({
        tenant_id: opts.tenantId ?? TENANT_ID,
        source,
        status: opts.status ?? PaymentSubmissionStatus.PENDING,
        submitted_by_user_id: ACTOR,
        amount: opts.amount ?? total,
        ...(source === PaymentSubmissionSource.PROOF
          ? {
              method: PaymentMethod.BKASH,
              paid_on: '2026-11-01',
              reference_raw: `trx ${seq}`,
              reference_normalised: `TRX${seq}`,
            }
          : {
              provider: PaymentGatewayProvider.BKASH,
              environment: PaymentGatewayEnvironment.SANDBOX,
              provider_trx_id: `PTRX${seq}`,
            }),
      }),
    );
    await subBillRepo.save(
      bills.map((b) =>
        subBillRepo.create({
          tenant_id: sub.tenant_id,
          submission_id: sub.id,
          student_fee_id: b.id,
          student_id: b.student_id,
          amount_at_start: Number(b.total_amount),
        }),
      ),
    );
    return sub;
  }

  const strict = (id: string, tenant = TENANT_ID) => svc.settle(id, tenant, ACTOR, 'PROOF_STRICT');
  const lenient = (id: string, tenant = TENANT_ID) =>
    svc.settle(id, tenant, ACTOR, 'ONLINE_LENIENT');
  const reload = (id: string) => subRepo.findOneByOrFail({ id });
  const payCount = () => paymentRepo.count({ where: { tenant_id: TENANT_ID } });

  /** A counter payment of `amount` against a bill, through the real checkout. */
  async function counterPay(bill: StudentFee, amount: number) {
    await checkout.checkout(
      {
        idempotency_key: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        lines: [{ student_fee_id: bill.id, amount, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
        change_handling: 'RETURN',
      } as any,
      TENANT_ID,
      ACTOR,
      { headers: {}, currentTenant: { id: TENANT_ID }, user: { sub: ACTOR } },
    );
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PaymentSubmissionSettlement,
        CheckoutService,
        {
          provide: getQueueToken(FEE_NOTIFY_QUEUE),
          useValue: { add: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SchoolsService,
          useValue: { getResolvedSettings: async () => ({ region: { timezone: 'Asia/Dhaka' } }) },
        },
        WalletService,
        AuditService,
        InvoicesService,
        ApprovalService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
      ],
      [StorageModule],
    );
    svc = module.get(PaymentSubmissionSettlement);
    checkout = module.get(CheckoutService);
    ds = module.get(DataSource);
    studentRepo = module.get(getRepositoryToken(Student));
    feeRepo = module.get(getRepositoryToken(StudentFee));
    paymentRepo = module.get(getRepositoryToken(Payment));
    subRepo = module.get(getRepositoryToken(PaymentSubmission));
    subBillRepo = module.get(getRepositoryToken(PaymentSubmissionBill));
    eventRepo = module.get(getRepositoryToken(PaymentSubmissionEvent));
    walletTxRepo = module.get(getRepositoryToken(WalletTransaction));
    auditRepo = module.get(getRepositoryToken(AuditLog));

    await ds.query('DELETE FROM schools');
    const schoolRepo = ds.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_ID, name: 'Test School', slug: 'test-settle' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other', slug: 'other-settle' }),
    );
    const userRepo = ds.getRepository(User);
    await userRepo.save(
      userRepo.create({
        id: ACTOR,
        email: SEED_ADMIN_EMAIL,
        password_hash: SEED_ADMIN_PASSWORD_HASH,
        full_name: 'Test Admin',
      }),
    );
    const ayRepo = ds.getRepository(AcademicYear);
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
    await ds.getRepository(Class).save(
      ds.getRepository(Class).create({
        id: SEED_CLASS_1_ID,
        name: 'Class 1',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
      }),
    );
    await ds.getRepository(ClassSection).save(
      ds.getRepository(ClassSection).create({
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
    for (const t of [
      'payment_submission_events',
      'payment_submission_bills',
      'payment_submissions',
      'audit_logs',
      'wallet_transactions',
      'student_wallets',
      'payment_allocations',
      'invoices',
      'payments',
      'student_fees',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('DELETE FROM students WHERE tenant_id IN ($1, $2)', [
      TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    const fs = ds.getRepository(FeeStructure);
    structureId = (
      await fs.save(
        fs.create({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Tuition Fee',
          amount: 1000,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      )
    ).id;
  });

  describe('PROOF_STRICT', () => {
    it('settles two students into two payments and invoices, received_by NULL, actor audited', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const b2 = await mkBill(s2.id, 700);
      const sub = await mkSubmission([b1, b2]);

      const res = await strict(sub.id);

      expect(res.outcome).toBe('SETTLED');
      expect(res.paymentIds).toHaveLength(2);
      const payments = await paymentRepo.find({ where: { tenant_id: TENANT_ID } });
      expect(payments).toHaveLength(2);
      for (const p of payments) {
        // Nobody at the counter took the money: received_by stays empty (D39).
        expect(p.received_by_user_id).toBeNull();
        expect(p.invoice_id).not.toBeNull();
        expect(p.transaction_reference).toBe(sub.reference_normalised);
        expect(p.payment_method).toBe(PaymentMethod.BKASH);
        expect(p.idempotency_key).toBe(settlementIdempotencyKey(sub.id, p.student_id));
      }
      // The actor is on the audit row (Payment has no created_by column).
      const audits = await auditRepo.find({ where: { action: AuditAction.PAYMENT_RECEIVED } });
      expect(audits).toHaveLength(2);
      expect(audits.every((a) => a.performed_by_user_id === ACTOR)).toBe(true);

      const bills = await subBillRepo.find({ where: { submission_id: sub.id } });
      expect(bills.every((b) => b.payment_id !== null)).toBe(true);
      const after = await reload(sub.id);
      expect(after.status).toBe(PaymentSubmissionStatus.CONFIRMED);
      expect(after.decided_by_user_id).toBe(ACTOR);
      expect(after.settled_at).not.toBeNull();
      const events = await eventRepo.find({ where: { submission_id: sub.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        from_status: PaymentSubmissionStatus.PENDING,
        to_status: PaymentSubmissionStatus.CONFIRMED,
        actor_user_id: ACTOR,
      });
      expect((await feeRepo.findOneByOrFail({ id: b1.id })).status).toBe(FeeStatus.PAID);
    });

    it('discards when one bill was paid at the counter, and pays nothing', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const b2 = await mkBill(s2.id, 700);
      const sub = await mkSubmission([b1, b2]);
      await counterPay(b2, 700);
      const before = await payCount();

      const res = await strict(sub.id);

      expect(res).toMatchObject({ outcome: 'DISCARDED', paymentIds: [] });
      expect(await payCount()).toBe(before);
      const after = await reload(sub.id);
      expect(after.status).toBe(PaymentSubmissionStatus.DISCARDED);
      expect(after.discard_reason).toBe('BILL_ALREADY_PAID');
      expect(await walletTxRepo.count()).toBe(0);
      const ev = await eventRepo.find({ where: { submission_id: sub.id } });
      expect(ev[0]).toMatchObject({
        to_status: PaymentSubmissionStatus.DISCARDED,
        reason_code: 'BILL_ALREADY_PAID',
      });
    });

    it('discards when a late fee changed the balance', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const sub = await mkSubmission([b1]);
      await feeRepo.update(b1.id, { total_amount: 1050 });

      const res = await strict(sub.id);

      expect(res.outcome).toBe('DISCARDED');
      expect((await reload(sub.id)).discard_reason).toBe('BALANCE_CHANGED');
      expect(await payCount()).toBe(0);
    });

    it('discards when a partial counter payment changed the balance', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const sub = await mkSubmission([b1]);
      await counterPay(b1, 400);
      const before = await payCount();

      const res = await strict(sub.id);

      expect(res.outcome).toBe('DISCARDED');
      expect((await reload(sub.id)).discard_reason).toBe('BALANCE_CHANGED');
      expect(await payCount()).toBe(before);
    });

    it('reopens a REJECTED proof and settles it', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const sub = await mkSubmission([b1], { status: PaymentSubmissionStatus.REJECTED });

      const res = await strict(sub.id);

      expect(res.outcome).toBe('SETTLED');
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.CONFIRMED);
      const ev = await eventRepo.find({ where: { submission_id: sub.id } });
      expect(ev[0].from_status).toBe(PaymentSubmissionStatus.REJECTED);
    });

    it('a second settle returns the same payments and writes nothing more', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id), await mkBill(s2.id)]);

      const first = await strict(sub.id);
      const second = await strict(sub.id);

      expect(second.alreadySettled).toBe(true);
      expect([...second.paymentIds].sort()).toEqual([...first.paymentIds].sort());
      expect(await payCount()).toBe(2);
      expect(await eventRepo.count({ where: { submission_id: sub.id } })).toBe(1);
    });

    it('two concurrent settles make one set of payments', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id), await mkBill(s2.id)]);

      const [a, b] = await Promise.all([strict(sub.id), strict(sub.id)]);

      expect(await payCount()).toBe(2);
      expect([a.alreadySettled, b.alreadySettled].sort()).toEqual([false, true]);
      expect([...a.paymentIds].sort()).toEqual([...b.paymentIds].sort());
    });

    it('finishes after a crash that left the first student paid', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const b2 = await mkBill(s2.id, 700);
      const sub = await mkSubmission([b1, b2]);
      // What a first run did before dying: student 1's checkout committed, nothing else.
      await checkout.checkout(
        {
          idempotency_key: settlementIdempotencyKey(sub.id, s1.id),
          lines: [{ student_fee_id: b1.id, amount: 1000, one_off_discount: 0 }],
          payment_method: PaymentMethod.BKASH,
          transaction_reference: sub.reference_normalised,
          change_handling: 'RETURN',
        } as any,
        TENANT_ID,
        ACTOR,
        { headers: {}, currentTenant: { id: TENANT_ID }, user: { sub: ACTOR } },
        undefined,
        { receivedByUserId: null },
      );

      const res = await strict(sub.id);

      expect(res.outcome).toBe('SETTLED');
      expect(res.paymentIds).toHaveLength(2);
      expect(await payCount()).toBe(2);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.CONFIRMED);
    });

    it('never discards once a student is already paid: partial race gives 409 and keeps the payment', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const b2 = await mkBill(s2.id, 700);
      const sub = await mkSubmission([b1, b2]);
      // Earlier crashed run: student 1 paid.
      await checkout.checkout(
        {
          idempotency_key: settlementIdempotencyKey(sub.id, s1.id),
          lines: [{ student_fee_id: b1.id, amount: 1000, one_off_discount: 0 }],
          payment_method: PaymentMethod.BKASH,
          transaction_reference: sub.reference_normalised,
          change_handling: 'RETURN',
        } as any,
        TENANT_ID,
        ACTOR,
        { headers: {}, currentTenant: { id: TENANT_ID }, user: { sub: ACTOR } },
        undefined,
        { receivedByUserId: null },
      );
      await counterPay(b2, 700);

      await expect(strict(sub.id)).rejects.toMatchObject({
        response: { details: { code: 'SETTLEMENT_PARTIAL' } },
      });

      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.PENDING);
      expect(
        await paymentRepo.count({
          where: { idempotency_key: settlementIdempotencyKey(sub.id, s1.id) },
        }),
      ).toBe(1);
      expect(await walletTxRepo.count()).toBe(0);
    });

    it('recovers when the second checkout throws once: next settle ends with one payment per student', async () => {
      const s1 = await mkStudent();
      const s2 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id, 1000), await mkBill(s2.id, 700)]);
      const real = checkout.checkout.bind(checkout);
      let calls = 0;
      const spy = vi.spyOn(checkout, 'checkout').mockImplementation((...args) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('boom'));
        return real(...args);
      });
      try {
        await expect(strict(sub.id)).rejects.toThrow('boom');
      } finally {
        spy.mockRestore();
      }
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.PENDING);
      expect(await payCount()).toBe(1);

      const res = await strict(sub.id);

      expect(res.outcome).toBe('SETTLED');
      expect(await payCount()).toBe(2);
      const bills = await subBillRepo.find({ where: { submission_id: sub.id } });
      expect(bills.every((b) => b.payment_id !== null)).toBe(true);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.CONFIRMED);
    });

    it('refuses states that cannot settle (WITHDRAWN 409), and a REVERSED one returns its payments', async () => {
      const s1 = await mkStudent();
      const withdrawn = await mkSubmission([await mkBill(s1.id)], {
        status: PaymentSubmissionStatus.WITHDRAWN,
      });
      await expect(strict(withdrawn.id)).rejects.toBeInstanceOf(ConflictException);

      const s2 = await mkStudent();
      const reversed = await mkSubmission([await mkBill(s2.id)], {
        status: PaymentSubmissionStatus.REVERSED,
      });
      const res = await strict(reversed.id);
      expect(res).toMatchObject({ alreadySettled: true, paymentIds: [] });
      expect(await payCount()).toBe(0);
    });

    it('answers 404 for another school and writes nothing', async () => {
      const s1 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id)]);
      await expect(strict(sub.id, OTHER_TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.PENDING);
    });

    it('answers 400 when the amount is not the sum of the bills', async () => {
      const s1 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id, 1000)], { amount: 999.99 });
      await expect(strict(sub.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(await payCount()).toBe(0);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.PENDING);
    });

    it('answers 400 when the mode does not match the source', async () => {
      const s1 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id)]);
      await expect(lenient(sub.id)).rejects.toBeInstanceOf(BadRequestException);
      const online = await mkSubmission([await mkBill(s1.id, 500, { occurrence: 2 })], {
        source: PaymentSubmissionSource.ONLINE,
      });
      await expect(
        svc.settle(online.id, TENANT_ID, ACTOR, 'PROOF_STRICT' as SettlementMode),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ONLINE_LENIENT', () => {
    it('settles in full when every bill is open', async () => {
      const s1 = await mkStudent();
      const sub = await mkSubmission([await mkBill(s1.id, 1000)], {
        source: PaymentSubmissionSource.ONLINE,
      });
      const res = await lenient(sub.id);
      expect(res).toMatchObject({ outcome: 'SETTLED', unmatched: false });
      expect(res.paymentIds).toHaveLength(1);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.COMPLETED);
      expect(await walletTxRepo.count()).toBe(0);
    });

    it('credits the remainder to the wallet when one bill was paid, and marks unmatched', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const b2 = await mkBill(s1.id, 600, { occurrence: 2 });
      const sub = await mkSubmission([b1, b2], { source: PaymentSubmissionSource.ONLINE });
      await counterPay(b2, 600);

      const res = await lenient(sub.id);

      expect(res.unmatched).toBe(true);
      expect(res.paymentIds).toHaveLength(1);
      const credits = await walletTxRepo.find({
        where: { kind: WalletTransactionKind.CREDIT_OVERPAYMENT },
      });
      expect(credits).toHaveLength(1);
      expect(Number(credits[0].amount)).toBe(600);
      const after = await reload(sub.id);
      expect(after.status).toBe(PaymentSubmissionStatus.COMPLETED);
      expect(after.unmatched).toBe(true);
    });

    it('sends everything to the wallet when all bills are paid, with no payment', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const sub = await mkSubmission([b1], { source: PaymentSubmissionSource.ONLINE });
      await counterPay(b1, 1000);
      const before = await payCount();

      const res = await lenient(sub.id);

      expect(res).toMatchObject({ outcome: 'SETTLED', unmatched: true, paymentIds: [] });
      expect(await payCount()).toBe(before);
      const credits = await walletTxRepo.find();
      expect(credits).toHaveLength(1);
      expect(Number(credits[0].amount)).toBe(1000);
      const bills = await subBillRepo.find({ where: { submission_id: sub.id } });
      expect(bills[0].payment_id).toBeNull();
    });

    it('settles a late callback on an EXPIRED attempt; double settle credits the wallet once', async () => {
      const s1 = await mkStudent();
      const b1 = await mkBill(s1.id, 1000);
      const sub = await mkSubmission([b1], {
        source: PaymentSubmissionSource.ONLINE,
        status: PaymentSubmissionStatus.EXPIRED,
      });
      await counterPay(b1, 1000);

      await Promise.all([lenient(sub.id), lenient(sub.id)]);

      expect(await walletTxRepo.count()).toBe(1);
      expect((await reload(sub.id)).status).toBe(PaymentSubmissionStatus.COMPLETED);
    });
  });
});
