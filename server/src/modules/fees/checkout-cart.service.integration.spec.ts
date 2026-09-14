import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  EnrollmentStatus,
  CommunicationMedium,
  FeeStatus,
  FeeType,
  PeriodType,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { CheckoutCartService } from './checkout-cart.service';
import { WalletService } from './wallet.service';
import { StudentFee } from './entities/student-fee.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Student } from '../students/entities/student.entity';

/**
 * Integration tests for CheckoutCartService (16.4.1), against the real
 * migrated test database — not `dropSchema`, so `WalletService`'s wallet
 * balance read goes through the actual `student_wallets`/
 * `wallet_transactions` tables including their migration-only triggers
 * (same reasoning as `wallet.service.integration.spec.ts`).
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000006c0001';
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-0000006c0002';

let studentSeq = 0;

function daysFromToday(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

describe('CheckoutCartService (integration)', () => {
  let moduleRef: TestingModule;
  let service: CheckoutCartService;
  let walletService: WalletService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let studentFeeRepo: Repository<StudentFee>;
  let feeStructureRepo: Repository<FeeStructure>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [CheckoutCartService, WalletService]);
    service = moduleRef.get(CheckoutCartService);
    walletService = moduleRef.get(WalletService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    studentFeeRepo = moduleRef.get(getRepositoryToken(StudentFee));
    feeStructureRepo = moduleRef.get(getRepositoryToken(FeeStructure));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Checkout Cart Other Tenant', 'checkout-cart-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    // `schools` is one of the six reference tables `test/setup.ts` resets
    // once per *file*, not per test (see `test/reset-order.ts`) — deleting
    // the OTHER_TENANT_ID row here would outlive this file and break
    // whichever fees spec happens to run next alphabetically. Only clean up
    // what this spec itself owns outside that global per-file reset.
    await dataSource.query(`TRUNCATE TABLE wallet_transactions`);
    await dataSource.query(`DELETE FROM student_wallets`);
    await dataSource.query(`DELETE FROM student_fees`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE wallet_transactions`);
    await dataSource.query(`DELETE FROM student_wallets`);
    await dataSource.query(`DELETE FROM student_fees`);
    // fee_structures is truncated by the global per-test beforeEach
    // (test/setup.ts) before this one runs — re-seed it every test.
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
        full_name: `Checkout Student ${studentSeq}`,
        registration_number: `CHK-${String(studentSeq).padStart(4, '0')}`,
        roll_number: studentSeq,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: tenantId,
        date_of_birth: new Date('2010-01-01'),
        preferred_communication: CommunicationMedium.SMS,
        enrollment_status: EnrollmentStatus.ACTIVE,
      } as Partial<Student>),
    );
  }

  function makeFee(studentId: string, overrides: Partial<StudentFee> = {}): Partial<StudentFee> {
    return {
      student_id: studentId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      fee_structure_id: TUITION_STRUCTURE_ID,
      period_start: daysFromToday(-60),
      period_type: PeriodType.MONTH,
      occurrence: 1,
      total_amount: 1000,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      status: FeeStatus.PENDING,
      due_date: daysFromToday(-10),
      ...overrides,
    };
  }

  async function credit(studentId: string, tenantId: string, amount: number): Promise<void> {
    await dataSource.transaction(async (manager: EntityManager) => {
      await walletService.credit(
        { studentId, tenantId, amount, kind: WalletTransactionKind.CREDIT_OVERPAYMENT },
        manager,
      );
    });
  }

  it('returns bills, wallet balance and an oldest-due-date-first suggestion across two students', async () => {
    const studentA = await makeStudent();
    const studentB = await makeStudent();

    // Oldest due date first: billA1 (-10d, 300) < billB1 (-5d, 200) <
    // billA2 (+5d, 400). Total balance = 900.
    const billA1 = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(studentA.id, {
          total_amount: 300,
          due_date: daysFromToday(-10),
          period_start: daysFromToday(-70),
        }),
      ),
    );
    const billB1 = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(studentB.id, {
          total_amount: 200,
          due_date: daysFromToday(-5),
          period_start: daysFromToday(-65),
        }),
      ),
    );
    const billA2 = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(studentA.id, {
          total_amount: 400,
          due_date: daysFromToday(5),
          period_start: daysFromToday(-40),
        }),
      ),
    );

    // Only studentA has a wallet credit — combined wallet pool is 50.
    await credit(studentA.id, SEED_TENANT_ID, 50);

    const result = await service.getCart([studentA.id, studentB.id], SEED_TENANT_ID, 1000);

    expect(result.total_balance).toBe(900);

    const studentAResult = result.students.find((s) => s.id === studentA.id)!;
    const studentBResult = result.students.find((s) => s.id === studentB.id)!;
    expect(studentAResult.wallet_balance).toBe(50);
    expect(studentBResult.wallet_balance).toBe(0);
    expect(studentAResult.bills).toHaveLength(2);
    expect(studentBResult.bills).toHaveLength(1);

    // overdue flag: due_date < today (Asia/Dhaka) — billA1/billB1 are past,
    // billA2 is in the future.
    const a1 = studentAResult.bills.find((b) => b.student_fee_id === billA1.id)!;
    const a2 = studentAResult.bills.find((b) => b.student_fee_id === billA2.id)!;
    const b1 = studentBResult.bills.find((b) => b.student_fee_id === billB1.id)!;
    expect(a1.is_overdue).toBe(true);
    expect(b1.is_overdue).toBe(true);
    expect(a2.is_overdue).toBe(false);

    // Allocation bookkeeping (`student_id`, `due_date_sort`,
    // `period_start_sort`) is internal — it must not leak into the response.
    expect(a1).not.toHaveProperty('student_id');
    expect(a1).not.toHaveProperty('due_date_sort');
    expect(a1).not.toHaveProperty('period_start_sort');

    // pool = wallet(50) + amount(1000) = 1050, total_balance = 900, so
    // every bill is fully covered: consumed = 900, wallet_used = 50 (the
    // whole wallet, since it's < consumed), cash_used = 850, and the
    // unused 150 of `amount` is overpayment → both remaining and to_wallet.
    expect(result.suggested).not.toBeNull();
    expect(result.suggested!.allocations).toEqual([
      { student_fee_id: billA1.id, amount: 300 },
      { student_fee_id: billB1.id, amount: 200 },
      { student_fee_id: billA2.id, amount: 400 },
    ]);
    // Every bill ends up fully paid (consumed 900 == total_balance), so
    // there's no unpaid balance left — `remaining` is 0. The unused 150 of
    // `amount` is pure overpayment, so it's `to_wallet` only; the two are
    // not the same field (see the multi-student wallet-isolation case below
    // for when `remaining` is actually nonzero).
    expect(result.suggested!.wallet_used).toBe(50);
    expect(result.suggested!.remaining).toBe(0);
    expect(result.suggested!.to_wallet).toBe(150);
  });

  it("never applies one student's wallet to another student's bill", async () => {
    const studentA = await makeStudent();
    const studentB = await makeStudent();

    // Student A has a wallet balance but no bills of their own.
    await credit(studentA.id, SEED_TENANT_ID, 500);
    // Student B has no wallet, but an open bill.
    const billB = await studentFeeRepo.save(
      studentFeeRepo.create(makeFee(studentB.id, { total_amount: 500 })),
    );

    // amount=0: the only money in play is student A's wallet, which must
    // never cross over onto student B's bill.
    const result = await service.getCart([studentA.id, studentB.id], SEED_TENANT_ID, 0);

    expect(result.suggested!.allocations).toEqual([]);
    expect(result.suggested!.wallet_used).toBe(0);
    expect(result.suggested!.remaining).toBe(500);
    expect(result.suggested!.to_wallet).toBe(0);

    const billBResult = result.students
      .find((s) => s.id === studentB.id)!
      .bills.find((b) => b.student_fee_id === billB.id)!;
    expect(billBResult.suggested_allocation).toBe(0);
  });

  it('excludes soft-deleted and PAID bills', async () => {
    const student = await makeStudent();
    const paid = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(student.id, {
          status: FeeStatus.PAID,
          paid_amount: 1000,
          period_start: daysFromToday(-90),
        }),
      ),
    );
    const open = await studentFeeRepo.save(
      studentFeeRepo.create(makeFee(student.id, { period_start: daysFromToday(-60) })),
    );
    const softDeleted = await studentFeeRepo.save(
      studentFeeRepo.create(makeFee(student.id, { period_start: daysFromToday(-30) })),
    );
    await studentFeeRepo.softDelete(softDeleted.id);

    const result = await service.getCart([student.id], SEED_TENANT_ID);

    const ids = result.students[0].bills.map((b) => b.student_fee_id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(paid.id);
    expect(ids).not.toContain(softDeleted.id);
  });

  it('breaks a due-date tie by period_start, then puts late fees last', async () => {
    const student = await makeStudent();
    const sameDueDate = daysFromToday(-3);

    const original = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(student.id, {
          period_start: daysFromToday(-30),
          due_date: sameDueDate,
          total_amount: 100,
        }),
      ),
    );
    const lateFee = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(student.id, {
          period_start: daysFromToday(-30),
          occurrence: 2,
          due_date: sameDueDate,
          total_amount: 50,
          late_fee_for_student_fee_id: original.id,
        }),
      ),
    );
    const laterPeriod = await studentFeeRepo.save(
      studentFeeRepo.create(
        makeFee(student.id, {
          period_start: daysFromToday(-29),
          due_date: sameDueDate,
          total_amount: 200,
        }),
      ),
    );

    const result = await service.getCart([student.id], SEED_TENANT_ID, 1000);

    expect(result.suggested!.allocations.map((a) => a.student_fee_id)).toEqual([
      original.id,
      lateFee.id,
      laterPeriod.id,
    ]);
    const lateBill = result.students[0].bills.find((b) => b.student_fee_id === lateFee.id)!;
    expect(lateBill.is_late_fee).toBe(true);
  });

  it('keeps tenants isolated — a student in another tenant is not returned', async () => {
    const student = await makeStudent(OTHER_TENANT_ID);
    await studentFeeRepo.save(studentFeeRepo.create(makeFee(student.id)));

    const result = await service.getCart([student.id], SEED_TENANT_ID);

    expect(result.students).toHaveLength(0);
    expect(result.total_balance).toBe(0);
  });

  it('returns no suggestion block when amount is omitted', async () => {
    const student = await makeStudent();
    await studentFeeRepo.save(studentFeeRepo.create(makeFee(student.id)));

    const result = await service.getCart([student.id], SEED_TENANT_ID);

    expect(result.suggested).toBeNull();
  });
});
