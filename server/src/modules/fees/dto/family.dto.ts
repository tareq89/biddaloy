import { ApiProperty } from '@nestjs/swagger';
import {
  DiscountKind,
  FeeStatus,
  FeeType,
  InvoiceKind,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
  PeriodType,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { Payment } from '../entities/payment.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import type { DiscountRule } from '../entities/discount-rule.entity';
import type { RecurringSchedule } from '../entities/recurring-schedule.entity';
import { Invoice, InvoiceSnapshot } from '../../invoices/entities/invoice.entity';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';
import type { StudentDueSummary } from '../fee-dues.service';

/**
 * [16.8.2] The one module that owns every family-facing (PARENT/STUDENT)
 * response shape in the fees/wallet/invoices/schedules surface.
 *
 * Before this ticket the mappers lived in four different DTO files
 * (`fees.dto.ts`, `wallet.dto.ts`, `invoices/dto/invoices.dto.ts`) next to
 * the staff DTOs they shadowed. That made "what can a guardian see?"
 * un-answerable without reading four files, and it is exactly the question
 * a reviewer has to answer every time a column is added to `Payment`,
 * `StudentFee` or `Invoice`.
 *
 * ```mermaid
 * flowchart LR
 *   A[FeeController] --> F[family.dto.ts]
 *   B[WalletController] --> F
 *   C[InvoicesController] --> F
 *   D[RecurringSchedulesController] --> F
 *   F --> G[allow-listed JSON]
 * ```
 *
 * Every mapper here is an **allow-list**, never a deny-list: a column added
 * to an entity later stays out of family responses until someone adds it
 * here on purpose. `family.dto.spec.ts` asserts key-for-key equality
 * against the published list, so widening the surface cannot happen by
 * accident.
 *
 * Withheld across the whole family surface, on purpose:
 * `approved_by_user_id`, `received_by_user_id`/`received_by_name`,
 * `fee_generation_id`, `idempotency_key`, `reminder_threshold_date`,
 * `reversal_reason`, and any internal free-text notes/remarks
 * (`Payment.remarks`, `PaymentAllocation.notes`, `Invoice.notes`,
 * `WalletTransaction.note`).
 */

/** A payment reference (cheque/card/bKash trx id) is the school's record of
 * an instrument, not a fact the family needs in full. Shown as its last 4
 * characters, matching what the public receipt (`PublicReceiptPaymentDto`)
 * already does. */
export function referenceLast4(reference: string | null | undefined): string | null {
  if (!reference) return null;
  return reference.slice(-4);
}

/** `StudentFee.occurrence` is 1 for the ordinary "one bill per period"
 * case, and 2, 3, … when a school bills the same fee twice in one period.
 * A family should see "Exam Fee (#2)", not a raw integer whose meaning is
 * internal, so occurrence 1 renders as `null` (nothing to disambiguate). */
export function occurrenceLabel(occurrence: number | null | undefined): string | null {
  if (!occurrence || occurrence <= 1) return null;
  return `#${occurrence}`;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Family-facing view of a payment allocation — which bill a slice of the
 * money went to.
 *
 * Withheld: `notes` (internal staff free text, same category as
 * `Payment.remarks`) and the `payment` back-reference (redundant inside the
 * payment's own response).
 */
export class FamilyPaymentAllocationDto {
  id: string;
  student_fee_id: string;
  allocated_amount: number;
  /** [16.8.2] The discount applied on this allocation. The family is
   * already told the discount on the bill itself; withholding it here made
   * the receipt's arithmetic not add up. */
  discount_amount: number;
  allocation_type: PaymentAllocationType;
  /** [16.4.3] Joined from `student_fee.fee_structure.name` /
   * `student_fee.period_start` at read time — `PaymentAllocation` itself
   * carries neither column. Null when the relation is missing (e.g. the
   * fee structure was soft-deleted) or wasn't loaded by the caller. */
  fee_name: string | null;
  period_start: Date | null;
}

/**
 * Family-facing view of a payment [5.1].
 *
 * `GET /payments/student/:studentId` and
 * `GET /payments/invoices/student/:studentId` are open to PARENT/STUDENT
 * since [5.1]. The raw `Payment` entity carries material a family must not
 * see:
 *
 * - `remarks` — internal free text staff write about a transaction
 * - `received_by_user_id` / `received_by` — which staff member took the
 *   money, and (if the relation is ever joined) that user's full record
 * - `approved_by_user_id`, `reversal_reason`, `idempotency_key`
 */
export class FamilyPaymentDto {
  id: string;
  student_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  transaction_reference: string | null;
  invoice_id: string | null;
  /** [16.8.2] The human-readable document number (`INV-2026-00042`), joined
   * from the `invoice` relation when loaded. Families quote this number
   * back to the office; making them resolve a UUID first was pointless. */
  invoice_number: string | null;
  /** [16.8.2] True when this row *is* a reversal of an earlier payment
   * (`reversal_of_payment_id IS NOT NULL`). The boolean is published; the
   * internal `reversal_reason` and the staff who approved it are not. */
  is_reversal: boolean;
  payment_date: Date;
  created_at: Date;
  allocations?: FamilyPaymentAllocationDto[];
}

export function toFamilyPayment(payment: Payment): FamilyPaymentDto {
  return {
    id: payment.id,
    student_id: payment.student_id,
    total_amount: payment.total_amount,
    payment_method: payment.payment_method,
    payment_status: payment.payment_status,
    transaction_reference: payment.transaction_reference,
    invoice_id: payment.invoice_id,
    // `invoice` is only present when the caller eager-loaded it; a caller
    // that didn't gets null rather than a crash.
    invoice_number: payment.invoice?.invoice_number ?? null,
    is_reversal: payment.reversal_of_payment_id !== null,
    payment_date: payment.payment_date,
    created_at: payment.created_at,
    ...(payment.allocations
      ? {
          allocations: payment.allocations.map((a) => ({
            id: a.id,
            student_fee_id: a.student_fee_id,
            allocated_amount: a.allocated_amount,
            discount_amount: a.discount_amount,
            allocation_type: a.allocation_type,
            // `student_fee`/`fee_structure` are only present if the caller
            // eager-loaded them; a caller that didn't (or a soft-deleted
            // fee structure) gets null here rather than a crash.
            fee_name: a.student_fee?.fee_structure?.name ?? null,
            period_start: a.student_fee?.period_start ?? null,
          })),
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Bills (StudentFee)
// ---------------------------------------------------------------------------

/**
 * Family-facing view of one bill [5.1].
 *
 * Withheld: `reminder_threshold_date` — internal dunning plumbing recording
 * when the school's reminder job would chase the fee. It is not something a
 * family can act on, and it exposes the school's collection policy. Also
 * withheld: `fee_generation_id` (which billing run produced the bill) and
 * `approved_by_user_id`.
 *
 * `is_advance_payment`/`original_advance_month`/`original_advance_year` were
 * removed from `StudentFee` entirely (16.1.3, D5) — a bill is now a concrete
 * (student, fee_structure, period) obligation with no "advance" bookkeeping
 * to withhold.
 *
 * Reused by every family surface that returns a StudentFee — the invoice's
 * `student_fee` relation and `getInvoiceSummary`'s `fee_breakdown` — so the
 * two cannot drift apart.
 */
export class FamilyStudentFeeDto {
  id: string;
  student_id: string;
  academic_year_id: string;
  fee_name: string;
  fee_type: FeeType;
  month: number;
  year: number;
  period_start: Date;
  period_type: PeriodType;
  /** [16.8.2] `"#2"` when the school billed this fee more than once in the
   * same period, `null` otherwise. See `occurrenceLabel`. */
  occurrence_label: string | null;
  /** [16.8.2] `late_fee_for_student_fee_id IS NOT NULL` — this bill IS a
   * late fee raised against another bill. Published as a flag so the portal
   * can label it; the bill it punishes stays internal. */
  is_late_fee: boolean;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  /** [16.8.2] `total_amount - discount_amount - paid_amount`, computed here
   * rather than left to the client so every family surface agrees on what
   * is still owed. */
  balance: number;
  status: FeeStatus;
  due_date: Date | null;
}

export function toFamilyStudentFee(fee: StudentFee): FamilyStudentFeeDto {
  return {
    id: fee.id,
    student_id: fee.student_id,
    academic_year_id: fee.academic_year_id,
    fee_name: fee.fee_structure.name,
    fee_type: fee.fee_structure.fee_type,
    month: fee.month,
    year: fee.year,
    period_start: fee.period_start,
    period_type: fee.period_type,
    occurrence_label: occurrenceLabel(fee.occurrence),
    is_late_fee: fee.late_fee_for_student_fee_id !== null,
    total_amount: fee.total_amount,
    paid_amount: fee.paid_amount,
    discount_amount: fee.discount_amount,
    balance: Number(fee.total_amount) - Number(fee.discount_amount) - Number(fee.paid_amount),
    status: fee.status,
    due_date: fee.due_date,
  };
}

// ---------------------------------------------------------------------------
// Dues (GET /fees/dues, family branch)
// ---------------------------------------------------------------------------

/**
 * Family-facing view of one open due inside `GET /fees/dues` [5.1].
 *
 * Same withholding as `FamilyStudentFeeDto` — a `DueEntry` carries
 * `reminder_threshold_date` too — plus `fee_structure_id` and the
 * `standing_discount_amount`/`one_off_discount_amount` split, which is the
 * school's internal discount bookkeeping. The family sees the single
 * `discount_amount` that actually reduces the bill.
 */
export class FamilyDueEntryDto {
  student_fee_id: string;
  fee_name: string;
  fee_type: FeeType;
  month: number;
  year: number;
  period_start: Date;
  period_type: PeriodType;
  occurrence_label: string | null;
  is_late_fee: boolean;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  balance: number;
  status: FeeStatus;
  due_date: Date | null;
}

/**
 * Family-facing view of one student's dues summary.
 *
 * The aggregate columns are all about the caller's own child, so they pass
 * through; only the nested `dues` rows need shaping.
 */
export class FamilyStudentDueDto {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
  dues: FamilyDueEntryDto[];
}

export function toFamilyStudentDue(summary: StudentDueSummary): FamilyStudentDueDto {
  return {
    student_id: summary.student_id,
    full_name: summary.full_name,
    registration_number: summary.registration_number,
    roll_number: summary.roll_number,
    class_name: summary.class_name,
    section_name: summary.section_name,
    total_due: summary.total_due,
    months_overdue: summary.months_overdue,
    dues: summary.dues.map((due) => ({
      student_fee_id: due.student_fee_id,
      fee_name: due.fee_name,
      fee_type: due.fee_type,
      month: due.month,
      year: due.year,
      period_start: due.period_start,
      period_type: due.period_type,
      occurrence_label: occurrenceLabel(due.occurrence),
      is_late_fee: due.is_late_fee,
      total_amount: due.total_amount,
      paid_amount: due.paid_amount,
      discount_amount: due.discount_amount,
      balance: due.balance,
      status: due.status,
      due_date: due.due_date,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fee structures (the published price list)
// ---------------------------------------------------------------------------

/**
 * Family-facing view of a fee structure [5.1] — the school's published price
 * list.
 *
 * Critically this drops `selected_students`, which `findOne` eager-loads for
 * the staff edit dialog: that relation carries other families' children in
 * full (name, date of birth, address, registration number, user id).
 */
export class FamilyFeeStructureDto {
  id: string;
  fee_type: FeeType;
  name: string;
  amount: number;
  class_id: string | null;
  section_id: string | null;
  academic_year_id: string;
}

export function toFamilyFeeStructure(structure: FeeStructure): FamilyFeeStructureDto {
  return {
    id: structure.id,
    fee_type: structure.fee_type,
    name: structure.name,
    amount: structure.amount,
    class_id: structure.class_id,
    section_id: structure.section_id,
    academic_year_id: structure.academic_year_id,
  };
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/**
 * A family-safe shape for a `WalletTransaction` row — everything a PARENT or
 * STUDENT needs to understand why the balance moved, and nothing internal.
 *
 * Withheld: `payment_id`, `student_fee_id`, `reversal_of_id`,
 * `created_by_user_id`, tenant/wallet ids, and — new in [16.8.2] — `note`,
 * which is staff free text of the same kind as `Payment.remarks` and was
 * being handed to families verbatim.
 */
export class FamilyWalletTransactionDto {
  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: WalletTransactionKind })
  kind: WalletTransactionKind;

  @ApiProperty()
  created_at: Date;
}

export function toFamilyWalletTransaction(tx: WalletTransaction): FamilyWalletTransactionDto {
  return {
    // tx.amount comes back from the pg driver as a numeric string; the DTO
    // promises `number` (matching `balance`, already normalized in
    // WalletService), so normalize here too rather than leak a string.
    amount: Number(tx.amount),
    kind: tx.kind,
    created_at: tx.created_at,
  };
}

export class FamilyStudentWalletResponseDto {
  @ApiProperty()
  balance: number;

  @ApiProperty({ type: [FamilyWalletTransactionDto] })
  transactions: FamilyWalletTransactionDto[];
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** Redacts an `IssuerSnapshot` down to what a family caller is entitled to
 * see: the school's public identity, not its contact/registration
 * internals. */
function redactIssuer(issuer: IssuerSnapshot): IssuerSnapshot {
  return {
    name: issuer.name,
    name_bn: issuer.name_bn,
    address: issuer.address,
    logo_key: issuer.logo_key,
    // Withheld from family callers: `phone`, `email`, `registration_id` —
    // internal/contact details, not needed to read a receipt.
    phone: null,
    email: null,
    registration_id: null,
    captured_at: issuer.captured_at,
  };
}

/** Redacts `invoice.snapshot` for a family caller:
 *
 * - `payment.received_by_name` names the staff member who took the payment —
 *   internal, not the family's business.
 * - `payment.reference` is cut to its last 4 characters ([16.8.2]): the full
 *   cheque/card/trx identifier is the school's record of the instrument.
 * - `issuer` is cut down to public identity fields.
 *
 * Everything else (lines, totals, method, payment_date) the family is
 * already entitled to see — they are their own fees and their own payment. */
function redactSnapshot(snapshot: InvoiceSnapshot): InvoiceSnapshot {
  return {
    ...snapshot,
    issuer: redactIssuer(snapshot.issuer),
    payment: {
      ...snapshot.payment,
      reference: referenceLast4(snapshot.payment.reference),
      received_by_name: null,
    },
  };
}

/**
 * Family-facing view of an invoice [5.1], updated for [16.5.1]'s
 * snapshot-based document.
 *
 * Withheld:
 *
 * - `issued_by` / `issued_by_user_id` — which staff member generated the
 *   invoice. `findOne` loads that relation as a full `User` (name, email and
 *   `password_hash` are on the entity); even the bare id is internal.
 * - `notes` ([16.8.2]) — the invoice's internal remarks field, the same
 *   category as `Payment.remarks`. It was being returned to families.
 *
 * `issued_by: null` is emitted rather than omitted so the response keeps the
 * stable shape the staff variant `toSafeInvoice` produces.
 */
export class FamilyInvoiceDto {
  id: string;
  invoice_number: string;
  kind: InvoiceKind;
  student_id: string;
  payment_id: string | null;
  related_invoice_id: string | null;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  status: InvoiceStatus;
  issued_date: Date;
  due_date: Date;
  snapshot: InvoiceSnapshot;
  // Explicitly described rather than inferred: the plugin cannot build a
  // schema for the literal type `null`, reports a circular dependency, and
  // aborts OpenAPI generation once this DTO is registered via
  // `@ApiExtraModels`. The runtime value is always `null` — the staff
  // variant's `issued_by` user is withheld from family callers, but the key
  // is kept (rather than omitted) so both variants share a stable shape.
  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    nullable: true,
  })
  issued_by: null;
  created_at: Date;
  updated_at: Date;
  /** [16.5.2] Present on `InvoicesService.findOne` (live-school fallback);
   * absent from `findAll`, which doesn't pay for an extra school read per
   * page. */
  issuer?: IssuerSnapshot;
}

export function toFamilyInvoice(invoice: Invoice & { issuer?: IssuerSnapshot }): FamilyInvoiceDto {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    kind: invoice.kind,
    student_id: invoice.student_id,
    payment_id: invoice.payment_id,
    related_invoice_id: invoice.related_invoice_id,
    total_amount: invoice.total_amount,
    tax_amount: invoice.tax_amount,
    discount_amount: invoice.discount_amount,
    status: invoice.status,
    issued_date: invoice.issued_date,
    due_date: invoice.due_date,
    snapshot: redactSnapshot(invoice.snapshot),
    issued_by: null,
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
    ...(invoice.issuer ? { issuer: redactIssuer(invoice.issuer) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Discount rules (GET /students/:id/discount-rules, family variant)
// ---------------------------------------------------------------------------

/**
 * [16.8.2] Family-facing view of a standing discount on the caller's own
 * child.
 *
 * This route has admitted PARENT/STUDENT since 16.7.x, but returned the
 * staff `DiscountRuleDto` unchanged — which carries three fields on this
 * epic's "withheld everywhere" list:
 *
 * - `created_by_user_id` / `approved_by_user_id` — which staff member
 *   granted the discount and which one signed off on it. A family that can
 *   see who approved a waiver can go and lean on that person directly.
 * - `reason` — internal staff free text ("Sponsored by the trustee",
 *   "Principal's discretion, do not repeat next year"). Same category as
 *   `Payment.remarks`.
 *
 * What a family legitimately needs is the money: how much comes off, on
 * which fee types, for how long, and whether it is live right now.
 */
export class FamilyDiscountRuleDto {
  id: string;
  student_id: string;
  kind: DiscountKind;
  value: number;
  fee_types: FeeType[] | null;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
}

export function toFamilyDiscountRule(rule: DiscountRule): FamilyDiscountRuleDto {
  return {
    id: rule.id,
    student_id: rule.student_id,
    kind: rule.kind,
    value: Number(rule.value),
    fee_types: rule.fee_types,
    starts_on: rule.starts_on,
    ends_on: rule.ends_on,
    is_active: rule.is_active,
  };
}

// ---------------------------------------------------------------------------
// Recurring schedules (GET /students/:id/schedules, family variant)
// ---------------------------------------------------------------------------

/** One fee a schedule bills each time it fires, as a family sees it. */
export class FamilyScheduleFeeDto {
  name: string;
  amount: number;
}

/**
 * [16.8.2] Family-facing view of a recurring schedule that bills the
 * caller's own child.
 *
 * The staff shape (`StudentScheduleItemDto`) is billing-automation config:
 * schedule ids, activity flags, and whether *this* student was explicitly
 * carved out of the audience. A guardian needs one thing only — "you will be
 * billed X on roughly this date" — so this DTO publishes the human answer
 * and nothing else. Notably withheld: the schedule `id` (nothing family-
 * facing accepts it), `audience` (other classes/sections), `excluded`
 * (reveals a staff decision about this child), `is_active`,
 * `last_run_period`, `created_by_user_id`.
 */
export class FamilyStudentScheduleDto {
  name: string;
  fees: FamilyScheduleFeeDto[];
  /** Plain-language cadence, e.g. `"Monthly on day 5"` or
   * `"Weekly on Sun, Tue"`. */
  rule_label: string;
  /** Start of the next period this schedule will bill (`YYYY-MM-DD`), or
   * null when it fires no more times inside its own window. */
  next_period: string | null;
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Turns a `RecurringScheduleRule` into a sentence a parent can read. */
export function ruleLabel(rule: RecurringSchedule['rule']): string {
  if (rule.kind === 'MONTHLY') {
    return rule.day_of_month === 'LAST'
      ? 'Monthly on the last day'
      : `Monthly on day ${rule.day_of_month}`;
  }
  const days = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_NAMES[d - 1] ?? String(d));
  return `Weekly on ${days.join(', ')}`;
}

export function toFamilyStudentSchedule(input: {
  schedule: RecurringSchedule;
  fees: Array<{ name: string; amount: number }>;
  next_period: string | null;
}): FamilyStudentScheduleDto {
  return {
    name: input.schedule.name,
    fees: input.fees.map((fee) => ({ name: fee.name, amount: fee.amount })),
    rule_label: ruleLabel(input.schedule.rule),
    next_period: input.next_period,
  };
}
