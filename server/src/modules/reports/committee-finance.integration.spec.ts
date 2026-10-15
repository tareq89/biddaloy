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
} from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { CollectionsReportService } from './collections-report.service';
import { FeeDuesService } from '../fees/fee-dues.service';
import { Student } from '../students/entities/student.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Payment } from '../fees/entities/payment.entity';

/**
 * [8.10.7.4.09] `CollectionsReportService.getCommitteeFinance`: per-month
 * billed / paid / outstanding (accrual, `student_fees.period_start`) plus the
 * same `current_month` block the collection-month widget returns.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000018900001';
const STRUCTURE_ID = '00000000-0000-4000-8000-000018900002';
const TODAY = '2026-10-07';

let seq = 0;

describe('CollectionsReportService.getCommitteeFinance', { timeout: 20000 }, () => {
  let moduleRef: TestingModule;
  let service: CollectionsReportService;
  let dues: FeeDuesService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let feeRepo: Repository<StudentFee>;
  let structureRepo: Repository<FeeStructure>;
  let paymentRepo: Repository<Payment>;
  let originalYear: { s: string; e: string; c: boolean };

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [CollectionsReportService, FeeDuesService]);
    service = moduleRef.get(CollectionsReportService);
    dues = moduleRef.get(FeeDuesService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    feeRepo = moduleRef.get(getRepositoryToken(StudentFee));
    structureRepo = moduleRef.get(getRepositoryToken(FeeStructure));
    paymentRepo = moduleRef.get(getRepositoryToken(Payment));
    [originalYear] = await dataSource.query(
      `SELECT to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e, is_current AS c FROM academic_years WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID],
    );
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'committee-finance-other', 'committee-finance-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await clean();
    await dataSource.query(
      `UPDATE academic_years SET start_date = $2, end_date = $3, is_current = $4 WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID, originalYear.s, originalYear.e, originalYear.c],
    );
    await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await moduleRef.close();
  });

  const clean = async () => {
    await dataSource.query(`DELETE FROM payment_allocations`);
    await dataSource.query(`DELETE FROM payments`);
    await dataSource.query(`DELETE FROM student_fees`);
  };

  beforeEach(async () => {
    await clean();
    // The tenant's current academic year is calendar 2026 for these cases.
    await dataSource.query(
      `UPDATE academic_years SET start_date = '2026-01-01', end_date = '2026-12-31', is_current = true WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID],
    );
    await structureRepo.save(
      structureRepo.create({
        id: STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  async function student(tenantId = SEED_TENANT_ID) {
    seq += 1;
    return studentRepo.save(
      studentRepo.create({
        full_name: `Committee Finance Student ${seq}`,
        registration_number: `CF-${String(seq).padStart(4, '0')}`,
        roll_number: seq,
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: CommunicationMedium.SMS,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: tenantId,
      } as Partial<Student>),
    );
  }

  let occ = 0;
  const bill = (studentId: string, period: string, o: Partial<StudentFee> = {}) => {
    occ += 1;
    return feeRepo.save(
      feeRepo.create({
        student_id: studentId,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        fee_structure_id: STRUCTURE_ID,
        period_start: new Date(period),
        period_type: PeriodType.MONTH,
        occurrence: occ,
        total_amount: 1000,
        paid_amount: 0,
        discount_amount: 0,
        one_off_discount_amount: 0,
        status: FeeStatus.PENDING,
        ...o,
        // CHK_student_fees_discount_split: discount = standing + one-off.
        standing_discount_amount: o.discount_amount ?? 0,
      } as Partial<StudentFee>),
    );
  };

  const pay = (studentId: string, o: Partial<Payment>, tenantId = SEED_TENANT_ID) => {
    seq += 1;
    return paymentRepo.save(
      paymentRepo.create({
        student_id: studentId,
        total_amount: 1000,
        payment_method: PaymentMethod.CASH,
        payment_status: PaymentStatus.SUCCESS,
        transaction_reference: `CF-TXN-${seq}`,
        payment_date: new Date('2026-10-03T05:00:00Z'),
        tenant_id: tenantId,
        ...o,
      } as Partial<Payment>),
    );
  };

  /** Jan..Oct 2026, every month present, zero-filled. */
  async function mixedFixture() {
    const s = await student();
    // Jan: paid in full, discounted.
    await bill(s.id, '2026-01-01', {
      total_amount: 1200,
      discount_amount: 200,
      paid_amount: 1000,
      status: FeeStatus.PAID,
    });
    // Aug: partly paid, decimals (0.1 + 0.2 must be exactly 0.3).
    await bill(s.id, '2026-08-01', {
      total_amount: 0.1,
      paid_amount: 0,
      status: FeeStatus.PENDING,
    });
    await bill(s.id, '2026-08-01', {
      total_amount: 0.2,
      paid_amount: 0,
      status: FeeStatus.PENDING,
    });
    // Oct: PAID, PARTIALLY_PAID, PENDING, WAIVED.
    await bill(s.id, '2026-10-01', {
      total_amount: 1000,
      paid_amount: 1000,
      status: FeeStatus.PAID,
    });
    await bill(s.id, '2026-10-01', {
      total_amount: 2000,
      paid_amount: 500,
      discount_amount: 100,
      status: FeeStatus.PARTIALLY_PAID,
    });
    await bill(s.id, '2026-10-01', { total_amount: 800, status: FeeStatus.PENDING });
    await bill(s.id, '2026-10-01', {
      total_amount: 700,
      discount_amount: 700,
      status: FeeStatus.WAIVED,
    });
    // Ignored: soft-deleted bill, future month, soft-deleted student's bill.
    const gone = await bill(s.id, '2026-10-01', { total_amount: 5000 });
    await feeRepo.softDelete(gone.id);
    await bill(s.id, '2026-11-01', { total_amount: 6000 });
    const deletedStudent = await student();
    await bill(deletedStudent.id, '2026-10-01', { total_amount: 7000 });
    await studentRepo.softDelete(deletedStudent.id);
    return s;
  }

  it('returns exact billed / paid / outstanding per month, zero-filled, ascending', async () => {
    await mixedFixture();
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    expect(res.months.map((m) => m.month)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]); // prettier-ignore
    const by = Object.fromEntries(res.months.map((m) => [m.month, m]));
    expect(by['2026-01']).toEqual({ month: '2026-01', billed: 1000, paid: 1000, outstanding: 0 });
    expect(by['2026-02']).toEqual({ month: '2026-02', billed: 0, paid: 0, outstanding: 0 });
    // 0.1 + 0.2 = 0.30000000000000004 in floats; money must be exactly 0.3.
    expect(by['2026-08']).toEqual({ month: '2026-08', billed: 0.3, paid: 0, outstanding: 0.3 });
    // billed = 1000 + 1900 + 800 + 0 ; paid = 1000 + 500 ; outstanding = 1400 + 800 (PAID/WAIVED excluded)
    expect(by['2026-10']).toEqual({
      month: '2026-10',
      billed: 3700,
      paid: 1500,
      outstanding: 2200,
    });
    expect(res.year_outstanding).toBe(2200.3);
  });

  it('has no entry for a future month, even when a bill exists for it', async () => {
    await mixedFixture();
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    expect(res.months.find((m) => m.month === '2026-11')).toBeUndefined();
  });

  it('reconciles with getBilledForMonth, FeeDuesService and the collection-month widget', async () => {
    const s = await mixedFixture();
    // Cash side of current_month: SUCCESS, a reversal row and a FAILED row.
    const original = await pay(s.id, { total_amount: 1000 });
    await pay(s.id, { total_amount: 400, payment_status: PaymentStatus.FAILED });
    await pay(s.id, {
      total_amount: 250,
      payment_status: PaymentStatus.REFUNDED,
      reversal_of_payment_id: original.id,
      payment_date: new Date('2026-10-04T05:00:00Z'),
    });
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    for (const m of res.months) {
      const first = `${m.month}-01`;
      const last = new Date(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5), 0))
        .toISOString()
        .slice(0, 10);
      expect(m.billed, m.month).toBe(await service.getBilledForMonth(SEED_TENANT_ID, first, last));
    }
    // The dues report counts every open bill, including the 6000 November bill
    // that is after today and so outside the series; everything else must agree.
    const allOpen = (await dues.getDuesByClass(SEED_TENANT_ID)).total_due;
    expect(res.year_outstanding).toBe(Math.round((allOpen - 6000) * 100) / 100);
    expect(res.current_month).toEqual(
      await service.getCollectionMonthWidget(SEED_TENANT_ID, TODAY),
    );
    // 1000 - 250 reversal; the FAILED 400 never counts.
    expect(res.current_month.received).toBe(750);
    expect(res.current_month.month).toBe('2026-10');
  });

  it('wallet-use basis: paid is what was applied to bills, not physical cash', async () => {
    const s = await student();
    // A 1000 bill paid with 600 cash + 400 wallet credit: the bill carries 1000.
    await bill(s.id, '2026-10-01', {
      total_amount: 1000,
      paid_amount: 1000,
      status: FeeStatus.PAID,
    });
    await pay(s.id, { total_amount: 1000, wallet_credit_used: 400 });
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    const oct = res.months.find((m) => m.month === '2026-10');
    expect(oct).toMatchObject({ billed: 1000, paid: 1000, outstanding: 0 });
    // current_month.received follows payments.total_amount (also applied-to-bills).
    expect(res.current_month.received).toBe(1000);
  });

  it('January: the series is one entry and last-month points at December', async () => {
    const s = await student();
    await bill(s.id, '2026-01-01', { total_amount: 500 });
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, '2026-01-15');
    expect(res.months).toEqual([{ month: '2026-01', billed: 500, paid: 0, outstanding: 500 }]);
    expect(res.current_month.month).toBe('2026-01');
    expect(res.current_month.last_month_same_point.as_of).toBe('2025-12-15');
  });

  it('month boundary: a bill on the last day belongs to its own month', async () => {
    const s = await student();
    await bill(s.id, '2026-09-30', { total_amount: 100 });
    await bill(s.id, '2026-10-01', { total_amount: 200 });
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    const by = Object.fromEntries(res.months.map((m) => [m.month, m.billed]));
    expect(by['2026-09']).toBe(100);
    expect(by['2026-10']).toBe(200);
  });

  it('Dhaka midnight: 2026-11 is in the series once the school day is 1 Nov', async () => {
    const s = await student();
    await bill(s.id, '2026-11-01', { total_amount: 900 });
    // SchoolsService.todayFor gives '2026-11-01' at 2026-10-31T18:30Z in Dhaka.
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, '2026-11-01');
    expect(res.months.at(-1)).toEqual({
      month: '2026-11',
      billed: 900,
      paid: 0,
      outstanding: 900,
    });
    expect(res.current_month.month).toBe('2026-11');
  });

  it("tenant isolation: tenant B's bills never enter tenant A's sums", async () => {
    const mine = await student();
    const theirs = await student(OTHER_TENANT_ID);
    await bill(mine.id, '2026-10-01', { total_amount: 100 });
    await bill(theirs.id, '2026-10-01', { total_amount: 900 });
    await pay(theirs.id, { total_amount: 900 }, OTHER_TENANT_ID);
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    expect(res.months.at(-1)).toMatchObject({ billed: 100, outstanding: 100 });
    expect(res.year_outstanding).toBe(100);
    expect(res.current_month.received).toBe(0);
  });

  it('with no current academic year it falls back to 1 January of the school year', async () => {
    await dataSource.query(`UPDATE academic_years SET is_current = false WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    const s = await student();
    await bill(s.id, '2026-03-01', { total_amount: 100 });
    const res = await service.getCommitteeFinance(SEED_TENANT_ID, TODAY);
    expect(res.months[0].month).toBe('2026-01');
    expect(res.months.find((m) => m.month === '2026-03')?.billed).toBe(100);
  });
});
