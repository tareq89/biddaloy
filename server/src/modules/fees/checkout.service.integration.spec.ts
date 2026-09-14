import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StorageModule } from '../storage/storage.module';
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
import { FeeStatus, FeeType, PaymentMethod, ApprovalScope } from '@biddaloy/shared';

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

  it('rejects a student_fee_id from another tenant (404)', async () => {
    const otherStudent = studentRepo.create({
      full_name: 'Other Tenant Student',
      registration_number: 'REG-CHKS-OTHER-0001',
      roll_number: 999,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: OTHER_TENANT_ID,
      date_of_birth: new Date('2010-01-01'),
      preferred_communication: 'SMS' as any,
    });
    const saved = await studentRepo.save(otherStudent);
    const otherStructure = await feeStructureRepo.save(
      feeStructureRepo.create({
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Other Tuition',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    const bill = await studentFeeRepo.save(
      makeBill(saved.id, { fee_structure_id: otherStructure.id, total_amount: 1000 }),
    );

    await expect(
      service.checkout(
        {
          idempotency_key: '88888888-8888-4888-8888-888888888888',
          lines: [{ student_fee_id: bill.id, amount: 1000, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a line amount that exceeds the bill balance', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(makeBill(student.id, { total_amount: 500 }));

    await expect(
      service.checkout(
        {
          idempotency_key: '99999999-9999-4999-8999-999999999999',
          lines: [{ student_fee_id: bill.id, amount: 600, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
        },
        TENANT_ID,
        ACTOR_USER_ID,
        requestWithToken(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a WAIVED bill even when its computed balance is non-zero (404, no write)', async () => {
    const student = await studentRepo.save(makeStudent());
    const bill = await studentFeeRepo.save(
      makeBill(student.id, {
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 0,
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
    ).rejects.toThrow(NotFoundException);

    const unchanged = await studentFeeRepo.findOneByOrFail({ id: bill.id });
    expect(unchanged.status).toBe(FeeStatus.WAIVED);
    expect(Number(unchanged.paid_amount)).toBe(0);
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

      await expect(
        service.checkout(dto, TENANT_ID, ACTOR_USER_ID, requestWithToken()),
      ).rejects.toThrow('simulated invoice-service outage');

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
});
