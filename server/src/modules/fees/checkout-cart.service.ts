import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { WalletService } from './wallet.service';

/** Mirrors `fee-dues.service.ts`'s private `OPEN_STATUSES` — duplicated
 * rather than imported/exported because `fee-dues.service.ts` is outside
 * this ticket's file territory. Keep in sync if that list ever changes. */
const OPEN_STATUSES = [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID];

/** Multi-student cart calls are capped here — the Record Payment modal never
 * opens with more than a handful of siblings selected, and this keeps the
 * combined-bills sort/allocation walk small. */
export const MAX_CART_STUDENTS = 10;

/** [D14] All "today" comparisons in Biddaloy go through the tenant's
 * calendar day in Asia/Dhaka, never server-local time — a bill due
 * `2026-09-14` must not flip to "overdue" at UTC midnight, six hours before
 * the school's own midnight. */
const SCHOOL_TIMEZONE = 'Asia/Dhaka';

function todayInSchoolTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIMEZONE }).format(new Date());
}

/** `due_date`/`period_start` are `date` columns. The pg driver can hand
 * TypeORM either a `'YYYY-MM-DD'` string or a `Date` (depending on driver
 * config), so every comparison below goes through this to a single
 * `'YYYY-MM-DD'` key first — comparing a `Date` object with `!==`/`<`
 * directly is wrong (`!==` is reference equality on two distinct instances
 * for the same day) and would silently break both the overdue check and
 * the tie-break sort. `.toISOString()` (UTC), not a local-timezone format:
 * `Date` values for a `date` column already come back at UTC midnight, so
 * this never shifts the calendar day either way. */
function dateKey(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today;
}

export interface CartBill {
  student_fee_id: string;
  fee_name: string;
  fee_type: FeeType;
  period_start: Date;
  period_type: PeriodType;
  occurrence: number;
  total_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
  paid_amount: number;
  balance: number;
  due_date: Date | null;
  is_late_fee: boolean;
  is_overdue: boolean;
  suggested_allocation: number;
}

export interface CartStudent {
  id: string;
  full_name: string;
  registration_number: string;
  class_name: string | null;
  section_name: string | null;
  wallet_balance: number;
  bills: CartBill[];
}

export interface SuggestedAllocationEntry {
  student_fee_id: string;
  amount: number;
}

export interface SuggestedAllocation {
  allocations: SuggestedAllocationEntry[];
  wallet_used: number;
  remaining: number;
  to_wallet: number;
}

export interface CheckoutCartResult {
  students: CartStudent[];
  total_balance: number;
  suggested: SuggestedAllocation | null;
}

/** Internal shape carried alongside a `CartBill` while sorting/allocating,
 * before the per-student grouping is rebuilt for the response. */
interface FlatBill extends CartBill {
  student_id: string;
  due_date_sort: string | null;
  period_start_sort: string;
}

@Injectable()
export class CheckoutCartService {
  constructor(
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Everything the Record Payment modal needs for one or more students:
   * every open bill, wallet balance, and (when `amount` is given) an
   * oldest-due-date-first allocation suggestion (16.4.1).
   *
   * `studentIds` must already be narrowed to what the caller may see — a
   * family caller's own-children check happens in the controller, before
   * this runs, the same seam `FeeDuesService.getDues` uses.
   */
  async getCart(
    studentIds: string[],
    tenantId: string,
    amount?: number,
  ): Promise<CheckoutCartResult> {
    if (studentIds.length === 0) {
      return { students: [], total_balance: 0, suggested: null };
    }

    const students = await this.studentRepo.find({
      where: { id: In(studentIds), tenant_id: tenantId },
      relations: ['class_section', 'class_section.class'],
    });

    const [fees, wallets] = await Promise.all([
      this.studentFeeRepo.find({
        where: { student_id: In(studentIds), status: In(OPEN_STATUSES) },
        relations: ['fee_structure'],
        order: { due_date: 'ASC', period_start: 'ASC' },
      }),
      Promise.all(students.map((s) => this.walletService.balance(s.id, tenantId))),
    ]);

    // `fees` is queried by student_id alone (no tenant join) because
    // StudentFee carries no tenant_id column of its own — tenant isolation
    // instead comes from `students` above already being scoped to
    // `tenantId`: a bill for a student outside that set is simply never
    // grouped under anything and is dropped below.
    const feesByStudent = new Map<string, StudentFee[]>();
    for (const fee of fees) {
      // A soft-deleted fee_structure leaves `fee_structure` null on the join
      // (TypeORM does not filter it — the FK still points at a row that
      // exists, just marked deleted). There's no sane fee_name/fee_type to
      // show for it, so it's dropped from the cart entirely.
      if (fee.fee_structure === null) continue;
      const list = feesByStudent.get(fee.student_id) ?? [];
      list.push(fee);
      feesByStudent.set(fee.student_id, list);
    }

    const walletByStudent = new Map(students.map((s, i) => [s.id, wallets[i]]));
    const today = todayInSchoolTimezone();

    // Grouped by student first, so per-student wallet allocation (below)
    // never needs to re-derive which bills belong to which student.
    const flatBillsByStudent = new Map<string, FlatBill[]>();
    const flatBills: FlatBill[] = [];
    for (const student of students) {
      const bills = (feesByStudent.get(student.id) ?? []).map((fee): FlatBill => {
        const totalAmount = Number(fee.total_amount);
        const paidAmount = Number(fee.paid_amount);
        const discountAmount = Number(fee.discount_amount);
        const dueDate = dateKey(fee.due_date);
        const bill: FlatBill = {
          student_id: student.id,
          student_fee_id: fee.id,
          fee_name: fee.fee_structure.name,
          fee_type: fee.fee_structure.fee_type,
          period_start: fee.period_start,
          period_type: fee.period_type,
          occurrence: fee.occurrence,
          total_amount: totalAmount,
          standing_discount_amount: Number(fee.standing_discount_amount),
          one_off_discount_amount: Number(fee.one_off_discount_amount),
          paid_amount: paidAmount,
          balance: Math.max(0, round2(totalAmount - discountAmount - paidAmount)),
          due_date: fee.due_date,
          is_late_fee: fee.late_fee_for_student_fee_id !== null,
          is_overdue: isOverdue(dueDate, today),
          suggested_allocation: 0,
          due_date_sort: dueDate,
          period_start_sort: dateKey(fee.period_start) as string,
        };
        flatBills.push(bill);
        return bill;
      });
      flatBillsByStudent.set(student.id, bills);
    }

    const total_balance = round2(flatBills.reduce((sum, b) => sum + b.balance, 0));

    const suggested =
      amount === undefined ? null : buildSuggestion(flatBillsByStudent, walletByStudent, amount);

    const cartStudents: CartStudent[] = students.map((student) => ({
      id: student.id,
      full_name: student.full_name,
      registration_number: student.registration_number,
      class_name: student.class_section?.class?.name ?? null,
      section_name: student.class_section?.section_name ?? null,
      wallet_balance: walletByStudent.get(student.id) ?? 0,
      bills: (flatBillsByStudent.get(student.id) ?? []).map(toCartBill),
    }));

    return { students: cartStudents, total_balance, suggested };
  }
}

/** Strips the sort-only fields off a `FlatBill` before it leaves the module
 * — `student_id`/`due_date_sort`/`period_start_sort` are allocation-time
 * bookkeeping, not part of the documented `GET /payments/cart` response. */
function toCartBill(bill: FlatBill): CartBill {
  const {
    student_id: _studentId,
    due_date_sort: _dueDateSort,
    period_start_sort: _periodStartSort,
    ...cartBill
  } = bill;
  return cartBill;
}

/**
 * [16.4.1] step 2, two phases:
 *
 * 1. Each student's own wallet pays down only that same student's own
 *    bills, oldest `due_date` first. Wallets are strictly per-student (see
 *    `WalletService`) — student A's balance must never cover student B's
 *    bill, even inside one multi-student cart, so this phase never crosses
 *    a student boundary and never re-pools a student's leftover wallet
 *    onto anyone else's balance.
 * 2. The shared `amount` (cash) is then applied tenant-wide, oldest
 *    `due_date` first across every student's remaining balance — cash
 *    pays no favorites, so unlike wallet it is genuinely a pooled `amount`.
 *
 * `suggested_allocation` accumulates both phases' contribution to a bill,
 * since which pot paid a given bill doesn't matter to the caller — only
 * the wallet_used/remaining/to_wallet breakdown at the end does:
 * - `wallet_used`: total actually drawn from wallets in phase 1.
 * - `to_wallet`: cash left over once every bill is fully covered — this is
 *   overpayment that goes to the student's wallet next.
 * - `remaining`: unpaid balance still outstanding after both phases —
 *   distinct from `to_wallet` whenever `amount` + wallets don't cover
 *   every bill.
 */
function buildSuggestion(
  billsByStudent: Map<string, FlatBill[]>,
  walletByStudent: Map<string, number>,
  amount: number,
): SuggestedAllocation {
  const allocations: SuggestedAllocationEntry[] = [];

  // Phase 1 — each student's own wallet against only their own bills.
  let walletUsed = 0;
  for (const [studentId, bills] of billsByStudent) {
    let walletRemaining = Math.max(0, walletByStudent.get(studentId) ?? 0);
    if (walletRemaining <= 0) continue;
    const sorted = [...bills].sort(compareBillsOldestFirst);
    for (const bill of sorted) {
      if (walletRemaining <= 0) break;
      const alloc = round2(Math.min(bill.balance - bill.suggested_allocation, walletRemaining));
      if (alloc > 0) {
        bill.suggested_allocation = round2(bill.suggested_allocation + alloc);
        walletRemaining = round2(walletRemaining - alloc);
        walletUsed = round2(walletUsed + alloc);
      }
    }
  }

  // Phase 2 — shared cash, tenant-wide, oldest due date first.
  const allBills = Array.from(billsByStudent.values()).flat().sort(compareBillsOldestFirst);
  const remainingAfterWallet = round2(
    allBills.reduce((sum, b) => sum + (b.balance - b.suggested_allocation), 0),
  );
  const cashUsed = round2(Math.min(amount, remainingAfterWallet));
  let cashRemaining = cashUsed;
  for (const bill of allBills) {
    if (cashRemaining <= 0) break;
    const alloc = round2(Math.min(bill.balance - bill.suggested_allocation, cashRemaining));
    if (alloc > 0) {
      bill.suggested_allocation = round2(bill.suggested_allocation + alloc);
      cashRemaining = round2(cashRemaining - alloc);
    }
  }

  for (const bill of allBills) {
    if (bill.suggested_allocation > 0) {
      allocations.push({ student_fee_id: bill.student_fee_id, amount: bill.suggested_allocation });
    }
  }

  const totalBalance = round2(allBills.reduce((sum, b) => sum + b.balance, 0));
  const totalAllocated = round2(walletUsed + cashUsed);
  const remaining = round2(Math.max(0, totalBalance - totalAllocated));
  const toWallet = round2(amount - cashUsed);

  return {
    allocations,
    wallet_used: walletUsed,
    remaining,
    to_wallet: toWallet,
  };
}

function compareBillsOldestFirst(a: FlatBill, b: FlatBill): number {
  const aDue = a.due_date_sort;
  const bDue = b.due_date_sort;
  // Bills with no due date sort last — there is no "oldest" to compare.
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue < bDue ? -1 : 1;
  }
  if (a.period_start_sort !== b.period_start_sort) {
    return a.period_start_sort < b.period_start_sort ? -1 : 1;
  }
  if (a.is_late_fee !== b.is_late_fee) {
    return a.is_late_fee ? 1 : -1;
  }
  return a.student_fee_id.localeCompare(b.student_fee_id);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
