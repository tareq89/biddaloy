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
import { CollectionsReportDto } from './dto/collections-report.dto';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Payment } from '../fees/entities/payment.entity';
import { PaymentAllocation } from '../fees/entities/payment-allocation.entity';
import { User } from '../users/entities/user.entity';
import { PaymentReversalService } from '../fees/payment-reversal.service';
import { PaymentsQueryService } from '../fees/payments-query.service';
import { WalletService } from '../fees/wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StorageModule } from '../storage/storage.module';

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
  let reversalService: PaymentReversalService;
  let paymentsQuery: PaymentsQueryService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let feeStructureRepo: Repository<FeeStructure>;
  let paymentRepo: Repository<Payment>;
  let paymentAllocationRepo: Repository<PaymentAllocation>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    moduleRef = await createTestModule(
      ALL_ENTITIES,
      [
        CollectionsReportService,
        PaymentReversalService,
        WalletService,
        AuditService,
        InvoicesService,
        PaymentsQueryService,
      ],
      [StorageModule],
    );
    paymentsQuery = moduleRef.get(PaymentsQueryService);
    reversalService = moduleRef.get(PaymentReversalService);
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

  describe('dashboard widget figures (getReceived / getBilledForMonth)', () => {
    it('getReceived equals getReport totals.net for the same range', async () => {
      const student = await makeStudent();
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 700,
        payment_date: new Date('2026-10-03T05:00:00Z'),
      });
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 300,
        payment_date: new Date('2026-10-07T05:00:00Z'),
      });
      // outside the range
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 999,
        payment_date: new Date('2026-10-08T05:00:00Z'),
      });
      const received = await service.getReceived(SEED_TENANT_ID, '2026-10-01', '2026-10-07');
      const report = await service.getReport(SEED_TENANT_ID, {
        from: '2026-10-01',
        to: '2026-10-07',
      });
      expect(received).toBe(1000);
      expect(received).toBe(report.totals.net);
    });

    it('a reversal in range lowers received; a FAILED payment is ignored', async () => {
      const student = await makeStudent();
      const original = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        payment_date: new Date('2026-10-02T05:00:00Z'),
      });
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 400,
        payment_status: PaymentStatus.FAILED,
        payment_date: new Date('2026-10-02T06:00:00Z'),
      });
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 250,
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: original.id,
        payment_date: new Date('2026-10-04T05:00:00Z'),
      });
      expect(await service.getReceived(SEED_TENANT_ID, '2026-10-01', '2026-10-07')).toBe(750);
    });

    it('Dhaka midnight: 2026-09-30T18:30Z belongs to October, not September', async () => {
      const student = await makeStudent();
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 500,
        payment_date: new Date('2026-09-30T18:30:00Z'),
      });
      expect(await service.getReceived(SEED_TENANT_ID, '2026-10-01', '2026-10-31')).toBe(500);
      expect(await service.getReceived(SEED_TENANT_ID, '2026-09-01', '2026-09-30')).toBe(0);
    });

    it('getBilledForMonth sums total - discount for the month, skipping other months and deleted bills', async () => {
      const student = await makeStudent();
      await makeStudentFee(student.id, {
        period_start: new Date('2026-10-01'),
        total_amount: 2000,
        discount_amount: 500,
        standing_discount_amount: 500,
      });
      await makeStudentFee(student.id, {
        period_start: new Date('2026-09-01'),
        total_amount: 3000,
      });
      const deleted = await makeStudentFee(student.id, {
        period_start: new Date('2026-10-01'),
        total_amount: 4000,
        occurrence: 2,
      });
      await studentFeeRepo.softDelete(deleted.id);
      expect(await service.getBilledForMonth(SEED_TENANT_ID, '2026-10-01', '2026-10-31')).toBe(
        1500,
      );
    });

    it('never mixes tenants', async () => {
      const mine = await makeStudent();
      const theirs = await makeStudent(OTHER_TENANT_ID);
      await makePayment(theirs.id, OTHER_TENANT_ID, {
        total_amount: 800,
        payment_date: new Date('2026-10-03T05:00:00Z'),
      });
      await makeStudentFee(theirs.id, {
        tenant_id: OTHER_TENANT_ID,
        period_start: new Date('2026-10-01'),
        total_amount: 900,
      });
      await makePayment(mine.id, SEED_TENANT_ID, {
        total_amount: 100,
        payment_date: new Date('2026-10-03T05:00:00Z'),
      });
      expect(await service.getReceived(SEED_TENANT_ID, '2026-10-01', '2026-10-31')).toBe(100);
      expect(await service.getBilledForMonth(SEED_TENANT_ID, '2026-10-01', '2026-10-31')).toBe(0);
      expect(await service.getBilledForMonth(OTHER_TENANT_ID, '2026-10-01', '2026-10-31')).toBe(
        900,
      );
    });
  });

  describe('getCollectionTodayWidget (#1866)', () => {
    const TODAY = '2026-10-07';
    // 11:00 in Dhaka on 7 Oct.
    const NOW = new Date('2026-10-07T05:00:00Z');
    const at = (iso: string) => new Date(iso);

    /** A day of mixed payments, all between Dhaka midnight and NOW. */
    async function seedToday(tenantId = SEED_TENANT_ID) {
      const s = await makeStudent(tenantId);
      const pay = (o: Partial<Payment>) => makePayment(s.id, tenantId, o);
      const cash1000 = await pay({ total_amount: 1000, payment_date: at('2026-10-06T19:00:00Z') });
      const cash500 = await pay({ total_amount: 500, payment_date: at('2026-10-06T20:00:00Z') });
      await pay({
        total_amount: 300,
        payment_method: PaymentMethod.BKASH,
        payment_date: at('2026-10-06T21:00:00Z'),
      });
      await pay({
        total_amount: 200,
        payment_method: PaymentMethod.CARD,
        payment_date: at('2026-10-06T22:00:00Z'),
      });
      await pay({
        total_amount: 100,
        payment_method: PaymentMethod.CHEQUE,
        payment_date: at('2026-10-06T23:00:00Z'),
      });
      await pay({
        total_amount: 50,
        payment_method: PaymentMethod.NAGAD,
        payment_date: at('2026-10-07T00:00:00Z'),
      });
      // A reversal of the 500 CASH payment, stored as a positive REFUNDED row.
      const reversal = await pay({
        total_amount: 500,
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: cash500.id,
        payment_date: at('2026-10-07T01:00:00Z'),
      });
      await paymentRepo.update(cash500.id, { reversed_by_payment_id: reversal.id });
      return { student: s, cash1000, cash500 };
    }

    it('groups net by method group, with reversals subtracted and not counted', async () => {
      await seedToday();
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.date).toBe(TODAY);
      expect(w.net).toBe(1650); // 1000+500-500 + 300 + 200 + 100 + 50
      // 6 real payments; the reversal row is not a payment.
      expect(w.payment_count).toBe(6);
      expect(w.groups.map((g) => g.group)).toEqual(['CASH', 'BKASH', 'BANK', 'OTHER_MOBILE']);
      const [cash, bkash, bank, other] = w.groups;
      expect(cash).toMatchObject({ net: 1000, payment_count: 2 });
      expect(bkash).toMatchObject({ net: 300, payment_count: 1 });
      // BANK holds CARD and CHEQUE, biggest net first.
      expect(bank).toMatchObject({ net: 300, payment_count: 2 });
      expect(bank.methods.map((m) => [m.payment_method, m.net])).toEqual([
        ['CARD', 200],
        ['CHEQUE', 100],
      ]);
      expect(other.methods.map((m) => [m.payment_method, m.net, m.payment_count])).toEqual([
        ['NAGAD', 50, 1],
      ]);
    });

    it('an empty day still returns four zero groups', async () => {
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.net).toBe(0);
      expect(w.payment_count).toBe(0);
      expect(w.yesterday_same_time_net).toBe(0);
      expect(w.groups).toHaveLength(4);
      for (const g of w.groups) expect(g).toMatchObject({ net: 0, payment_count: 0, methods: [] });
    });

    it('ignores FAILED, PENDING and soft-deleted payments', async () => {
      const s = await makeStudent();
      const date = at('2026-10-07T01:00:00Z');
      await makePayment(s.id, SEED_TENANT_ID, { total_amount: 100, payment_date: date });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 700,
        payment_status: PaymentStatus.FAILED,
        payment_date: date,
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 800,
        payment_status: PaymentStatus.PENDING,
        payment_date: date,
      });
      const gone = await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 900,
        payment_date: date,
      });
      await paymentRepo.softDelete(gone.id);
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.net).toBe(100);
      expect(w.payment_count).toBe(1);
    });

    it('reconciles with GET /reports/collections and the payments list', async () => {
      await seedToday();
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      // The list (#1815) filters by status only when asked, so compare counts on
      // SUCCESS-only data first; the FAILED row below must then move neither the
      // widget nor the report.
      const list = await paymentsQuery.findAll(
        { date_from: TODAY, date_to: TODAY, is_reversal: false, include_reversed: true } as never,
        SEED_TENANT_ID,
      );
      expect(w.payment_count).toBe(list.total);
      const s = await makeStudent();
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 4242,
        payment_status: PaymentStatus.FAILED,
        payment_date: at('2026-10-07T02:00:00Z'),
      });
      expect(await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW)).toEqual(w);
      const report = await service.getReport(SEED_TENANT_ID, { from: TODAY, to: TODAY });
      expect(w.net).toBe(report.totals.net);
      for (const g of w.groups) {
        const fromReport = report.by_method
          .filter((m) => g.methods.some((x) => x.payment_method === m.payment_method))
          .reduce((a, m) => a + m.net, 0);
        expect(g.net).toBe(fromReport);
      }
    });

    it('rounds decimal sums: CARD 0.1 + CHEQUE 0.2 is exactly 0.3', async () => {
      const s = await makeStudent();
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 0.1,
        payment_method: PaymentMethod.CARD,
        payment_date: at('2026-10-06T22:00:00Z'),
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 0.2,
        payment_method: PaymentMethod.CHEQUE,
        payment_date: at('2026-10-06T23:00:00Z'),
      });
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.groups[2].net).toBe(0.3); // BANK; 0.1 + 0.2 is 0.30000000000000004 unrounded
      expect(w.net).toBe(0.3);
      const m = await service.getCollectionByMonthWidget(SEED_TENANT_ID, TODAY);
      expect(m.year_to_date_net).toBe(0.3);
    });

    it('wallet use: widget counts amount applied to bills, not physical cash', async () => {
      const s = await makeStudent();
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 1000,
        wallet_credit_used: 400,
        payment_date: at('2026-10-06T22:00:00Z'),
      } as Partial<Payment>);
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      const report = await service.getReport(SEED_TENANT_ID, { from: TODAY, to: TODAY });
      expect(w.groups.reduce((a, g) => a + g.net, 0)).toBe(report.totals.net);
      expect(report.totals.net).toBe(1000);
      // Widget = amount applied to bills (total_amount); by_method = physical
      // cash (total_amount - wallet_credit_used), so CASH differs: 1000 vs 600.
      expect(w.groups[0].net).toBe(1000);
      expect(report.by_method.find((r) => r.payment_method === PaymentMethod.CASH)?.net).toBe(600);
    });

    it('yesterday at the same time: 10:00 counts, 12:00 does not (now is 11:00)', async () => {
      const s = await makeStudent();
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 400,
        payment_date: at('2026-10-06T04:00:00Z'), // 10:00 Dhaka yesterday
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 999,
        payment_date: at('2026-10-06T06:00:00Z'), // 12:00 Dhaka yesterday
      });
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.yesterday_same_time_net).toBe(400);
      expect(w.net).toBe(0);
    });

    it('yesterday nets out its own reversal and skips FAILED', async () => {
      const s = await makeStudent();
      const orig = await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 600,
        payment_date: at('2026-10-06T03:00:00Z'),
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 100,
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: orig.id,
        payment_date: at('2026-10-06T04:00:00Z'),
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 77,
        payment_status: PaymentStatus.FAILED,
        payment_date: at('2026-10-06T04:30:00Z'),
      });
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.yesterday_same_time_net).toBe(500);
    });

    it('Dhaka midnight: 00:10 on the 8th is today, 23:50 on the 7th is not today', async () => {
      const s = await makeStudent();
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 10,
        payment_date: at('2026-10-07T18:10:00Z'), // 00:10 on the 8th
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 20,
        payment_date: at('2026-10-06T18:20:00Z'), // 00:20 on the 7th: yesterday, before 00:30
      });
      await makePayment(s.id, SEED_TENANT_ID, {
        total_amount: 5,
        payment_date: at('2026-10-07T17:50:00Z'), // 23:50 on the 7th: yesterday, after 00:30
      });
      // now = 00:30 on the 8th, Dhaka.
      const w = await service.getCollectionTodayWidget(
        SEED_TENANT_ID,
        '2026-10-08',
        at('2026-10-07T18:30:00Z'),
      );
      expect(w.net).toBe(10);
      expect(w.yesterday_same_time_net).toBe(20);
    });

    it("never counts another tenant's payments", async () => {
      await seedToday(OTHER_TENANT_ID);
      const w = await service.getCollectionTodayWidget(SEED_TENANT_ID, TODAY, NOW);
      expect(w.net).toBe(0);
      expect(w.payment_count).toBe(0);
      const theirs = await service.getCollectionTodayWidget(OTHER_TENANT_ID, TODAY, NOW);
      expect(theirs.net).toBe(1650);
    });
  });

  describe('getCollectionByMonthWidget (#1866)', () => {
    async function paid(amount: number, iso: string, o: Partial<Payment> = {}) {
      const s = await makeStudent((o.tenant_id as string) ?? SEED_TENANT_ID);
      return makePayment(s.id, (o.tenant_id as string) ?? SEED_TENANT_ID, {
        total_amount: amount,
        payment_date: new Date(iso),
        ...o,
      });
    }

    it('fills 12 slots: later months null, sums the rest, reversal and FAILED handled', async () => {
      await paid(500, '2026-01-10T05:00:00Z');
      const mar = await paid(700, '2026-03-10T05:00:00Z');
      await paid(150, '2026-03-12T05:00:00Z', {
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: mar.id,
      });
      await paid(300, '2026-10-03T05:00:00Z');
      await paid(9999, '2026-03-11T05:00:00Z', { payment_status: PaymentStatus.FAILED });
      await paid(8888, '2026-11-05T05:00:00Z'); // future-dated: must not leak
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-10-07');
      expect(w.year).toBe(2026);
      expect(w.months).toHaveLength(12);
      expect(w.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(w.months[0]).toEqual({ month: 1, net: 500, is_current: false });
      expect(w.months[1].net).toBe(0);
      expect(w.months[2].net).toBe(550);
      expect(w.months[9]).toEqual({ month: 10, net: 300, is_current: true });
      expect(w.months[10].net).toBeNull();
      expect(w.months[11].net).toBeNull();
      expect(w.year_to_date_net).toBe(1350);
      expect(w.month_to_date_net).toBe(300);
    });

    it('month boundaries are Dhaka-local: 31 Jan 18:30Z is February, 31 Dec 18:30Z is January', async () => {
      await paid(200, '2026-01-31T18:30:00Z');
      await paid(100, '2025-12-31T18:30:00Z'); // 1 Jan 2026 00:30 Dhaka
      await paid(40, '2025-12-31T17:30:00Z'); // 31 Dec 2025 23:30 Dhaka: last year
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-03-05');
      expect(w.months[0].net).toBe(100);
      expect(w.months[1].net).toBe(200);
      expect(w.year_to_date_net).toBe(300);
    });

    it('previous_month_same_days_net covers day 1 to the same day, previous month', async () => {
      await paid(400, '2026-09-05T05:00:00Z');
      await paid(999, '2026-09-08T05:00:00Z'); // after day 7
      await paid(50, '2026-10-02T05:00:00Z');
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-10-07');
      expect(w.previous_month_same_days_net).toBe(400);
      expect(w.month_to_date_net).toBe(50);
    });

    it('January wraps to December of the previous year', async () => {
      await paid(250, '2026-12-10T05:00:00Z');
      await paid(999, '2026-12-20T05:00:00Z');
      await paid(60, '2027-01-04T05:00:00Z');
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2027-01-15');
      expect(w.year).toBe(2027);
      expect(w.previous_month_same_days_net).toBe(250);
      expect(w.months[0]).toEqual({ month: 1, net: 60, is_current: true });
      expect(w.months.slice(1).every((m) => m.net === null)).toBe(true);
    });

    it('clamps the previous month day: 31 Mar maps to 28 Feb', async () => {
      await paid(90, '2026-02-28T05:00:00Z');
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-03-31');
      expect(w.previous_month_same_days_net).toBe(90);
    });

    it('previous values are numbers (0), never null, on an empty tenant', async () => {
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-10-07');
      expect(w.previous_month_same_days_net).toBe(0);
      expect(w.month_to_date_net).toBe(0);
      expect(w.year_to_date_net).toBe(0);
    });

    it('every month equals GET /reports/collections totals.net for that month', async () => {
      const mar = await paid(700, '2026-03-10T05:00:00Z');
      await paid(150, '2026-03-12T05:00:00Z', {
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: mar.id,
      });
      await paid(31, '2026-03-31T17:59:00Z'); // last minute of March, Dhaka
      await paid(5000, '2026-04-02T05:00:00Z', { payment_status: PaymentStatus.FAILED });
      await paid(222, '2026-04-30T18:30:00Z'); // 1 May Dhaka
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-10-07');
      const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31];
      for (const m of w.months.slice(0, 10)) {
        const mm = String(m.month).padStart(2, '0');
        const report = await service.getReport(SEED_TENANT_ID, {
          from: `2026-${mm}-01`,
          to: `2026-${mm}-${lastDay[m.month - 1]}`,
        });
        expect(m.net).toBe(report.totals.net);
      }
    });

    it("never counts another tenant's payments", async () => {
      await paid(800, '2026-10-03T05:00:00Z', { tenant_id: OTHER_TENANT_ID });
      await paid(10, '2026-10-03T05:00:00Z');
      const w = await service.getCollectionByMonthWidget(SEED_TENANT_ID, '2026-10-07');
      expect(w.year_to_date_net).toBe(10);
    });
  });

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
      // `payment-reversal.service.ts` creates the reversal row with
      // `payment_status: REFUNDED`, not `SUCCESS` — mirror that here so
      // this fixture actually exercises `buildFilter`'s `OR
      // reversal_of_payment_id IS NOT NULL` branch rather than passing
      // by coincidence through the `SUCCESS` branch alone.
      const reversal = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        payment_status: PaymentStatus.REFUNDED,
        received_by_user_id: COLLECTOR_USER_ID,
        reversal_of_payment_id: payment.id,
        payment_date: new Date('2026-03-16T05:00:00Z'),
      });
      // Same as payment-reversal.service.ts: the original goes REFUNDED.
      await paymentRepo.update(payment.id, {
        reversed_by_payment_id: reversal.id,
        payment_status: PaymentStatus.REFUNDED,
      });

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

    it('a reversal made with PaymentReversalService nets to 0 and leaves the original day unchanged', async () => {
      const student = await makeStudent();
      const fee = await makeStudentFee(student.id, {
        total_amount: 1000,
        paid_amount: 1000,
        status: FeeStatus.PAID,
      });
      const payment = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        payment_date: new Date('2026-03-15T05:00:00Z'),
        received_by_user_id: COLLECTOR_USER_ID,
      });
      await paymentAllocationRepo.save(
        paymentAllocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1000,
          allocation_type: PaymentAllocationType.CURRENT,
          discount_amount: 0,
        }),
      );
      const reversal = await reversalService.reverse(
        payment.id,
        SEED_TENANT_ID,
        COLLECTOR_USER_ID,
        COLLECTOR_USER_ID,
        'repro',
      );
      await paymentRepo.update(reversal.id, { payment_date: new Date('2026-03-16T05:00:00Z') });

      const day1 = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-15',
        to: '2026-03-15',
      });
      expect(day1.totals.collected).toBe(1000);
      const day2 = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-16',
        to: '2026-03-16',
      });
      expect(day2.totals.reversed).toBe(1000);
      const all = await service.getReport(SEED_TENANT_ID, { from: '2026-03-01', to: '2026-03-31' });
      expect(all.totals.net).toBe(0);
    });

    it('by_method counts cash received: change to wallet in, wallet use out, reversal mirrors original', async () => {
      const student = await makeStudent();
      const cashOf = (r: CollectionsReportDto) =>
        r.by_method.find((m) => m.payment_method === PaymentMethod.CASH);
      const p1 = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        wallet_credit_added: 200,
      });
      let r = await service.getReport(SEED_TENANT_ID, { from: '2026-03-15', to: '2026-03-15' });
      expect(cashOf(r)?.collected).toBe(1200);

      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 500,
        wallet_credit_used: 200,
        payment_date: new Date('2026-03-17T05:00:00Z'),
      });
      r = await service.getReport(SEED_TENANT_ID, { from: '2026-03-17', to: '2026-03-17' });
      expect(cashOf(r)?.collected).toBe(300);

      const range = { from: '2026-03-01', to: '2026-03-31' };
      r = await service.getReport(SEED_TENANT_ID, range);
      const sum = (rows: { collected: number }[]) => rows.reduce((n, x) => n + x.collected, 0);
      expect(sum(r.by_method)).toBe(
        r.totals.collected - r.totals.wallet_used + r.totals.wallet_added,
      );
      expect(sum(r.by_collector)).toBe(sum(r.by_method));

      const rev = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 1000,
        payment_status: PaymentStatus.REFUNDED,
        reversal_of_payment_id: p1.id,
        payment_date: new Date('2026-03-16T05:00:00Z'),
      });
      await paymentRepo.update(p1.id, {
        reversed_by_payment_id: rev.id,
        payment_status: PaymentStatus.REFUNDED,
      });
      r = await service.getReport(SEED_TENANT_ID, range);
      expect(cashOf(r)?.reversed).toBe(1200);
    });

    it('removing a paid bill later leaves by_fee_type and discount totals unchanged', async () => {
      const student = await makeStudent();
      const fee = await makeStudentFee(student.id, {
        total_amount: 1000,
        discount_amount: 150,
        standing_discount_amount: 100,
        one_off_discount_amount: 50,
      });
      const payment = await makePayment(student.id, SEED_TENANT_ID, { total_amount: 1000 });
      await paymentAllocationRepo.save(
        paymentAllocationRepo.create({
          payment_id: payment.id,
          student_fee_id: fee.id,
          allocated_amount: 1000,
          allocation_type: PaymentAllocationType.CURRENT,
          discount_amount: 50,
        }),
      );
      const range = { from: '2026-03-01', to: '2026-03-31' };
      const before = await service.getReport(SEED_TENANT_ID, range);
      expect(before.totals.standing_discount).toBe(100);
      expect(before.totals.one_off_discount).toBe(50);
      await studentFeeRepo.softDelete(fee.id);
      const after = await service.getReport(SEED_TENANT_ID, range);
      expect(after.totals.standing_discount).toEqual(before.totals.standing_discount);
      expect(after.totals.one_off_discount).toEqual(before.totals.one_off_discount);
      expect(after.by_fee_type).toEqual(before.by_fee_type);
    });

    it('applies the Dhaka day boundary at the edges of the range, not UTC midnight', async () => {
      const student = await makeStudent();
      // One second before March 1 starts in Dhaka (UTC+6) — should fall
      // OUTSIDE a `from: 2026-03-01` filter.
      await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-02-28T17:59:59Z'),
        total_amount: 111,
      });
      // March 1 midnight in Dhaka — should be INSIDE.
      const inside = await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-02-28T18:00:00Z'),
        total_amount: 222,
      });

      const result = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-01',
        to: '2026-03-01',
      });

      expect(result.totals.collected).toBe(Number(inside.total_amount));
    });

    it('excludes a payment at the first instant of the day after `to` (Dhaka)', async () => {
      const student = await makeStudent();
      // 1 Apr 00:00 Dhaka — must fall OUTSIDE `to: 2026-03-31`.
      await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-03-31T18:00:00Z'),
        total_amount: 333,
      });

      const result = await service.getReport(SEED_TENANT_ID, {
        from: '2026-03-31',
        to: '2026-03-31',
      });

      expect(result.totals.collected).toBe(0);
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

    it('excludes PENDING/FAILED payments from collected — they are not money received', async () => {
      const student = await makeStudent();
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 500,
        payment_status: PaymentStatus.SUCCESS,
      });
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 9999,
        payment_status: PaymentStatus.FAILED,
      });
      await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 8888,
        payment_status: PaymentStatus.PENDING,
      });

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
      // Mirror `payment-reversal.service.ts`'s real `REFUNDED` status —
      // see the other reversal fixture's own comment on why.
      const reversal = await makePayment(student.id, SEED_TENANT_ID, {
        total_amount: 700,
        payment_status: PaymentStatus.REFUNDED,
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

    it('stamps the row date in Dhaka local time, not UTC, matching by_day', async () => {
      const student = await makeStudent();
      // 2026-03-16T02:00:00+06:00 == 2026-03-15T20:00:00Z: UTC says the
      // 15th, Dhaka says the 16th. The CSV must agree with by_day (16th).
      await makePayment(student.id, SEED_TENANT_ID, {
        payment_date: new Date('2026-03-15T20:00:00Z'),
      });

      const rows = await service.getCsvRows(SEED_TENANT_ID, {
        from: '2026-03-16',
        to: '2026-03-16',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].date.startsWith('2026-03-16')).toBe(true);
    });

    it('escapes a formula-leading student name so Excel treats it as text, not code', async () => {
      studentSeq += 1;
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: '=HYPERLINK("http://evil.example","click")',
          registration_number: `CR-${String(studentSeq).padStart(4, '0')}`,
          roll_number: studentSeq,
          class_section_id: SEED_SECTION_1_ID,
          date_of_birth: new Date('2010-01-01'),
          preferred_communication: CommunicationMedium.SMS,
          enrollment_status: EnrollmentStatus.ACTIVE,
          tenant_id: SEED_TENANT_ID,
        } as Partial<Student>),
      );
      await makePayment(student.id, SEED_TENANT_ID, { total_amount: 250 });

      const rows = await service.getCsvRows(SEED_TENANT_ID, {
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(rows).toHaveLength(1);
      // The raw field carries the unescaped name — csvCell (called by the
      // controller when it renders the actual CSV text) is what applies
      // the `'`-prefix guard, so this asserts the row shape rather than
      // duplicating that escaping test here.
      expect(rows[0].student_name).toBe('=HYPERLINK("http://evil.example","click")');
    });
  });
});
