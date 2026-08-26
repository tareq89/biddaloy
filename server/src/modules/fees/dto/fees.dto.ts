import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  IsIn,
  IsBoolean,
  IsDateString,
  ArrayMinSize,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FeeType,
  FeeApplicability,
  PaymentMethod,
  PaymentStatus,
  PaymentAllocationType,
  FeeStatus,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { Payment } from '../entities/payment.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import type { DueEntry, StudentDueSummary } from '../fee-dues.service';

export type FeeDuesSortBy = 'due_amount' | 'name' | 'class';
export type SortOrder = 'ASC' | 'DESC';

export class CreateFeeStructureDto {
  @IsEnum(FeeType)
  fee_type: FeeType;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsEnum(FeeApplicability)
  applicability?: FeeApplicability;

  @IsUUID()
  class_id: string;

  /** Nullable for the same reason as `UpdateFeeStructureDto.section_id`:
   * "whole class" is an explicit `null`, not an absent key. */
  @IsOptional()
  @IsUUID()
  section_id?: string | null;

  @IsUUID()
  academic_year_id: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class UpdateFeeStructureDto {
  @IsOptional()
  @IsEnum(FeeType)
  fee_type?: FeeType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsEnum(FeeApplicability)
  applicability?: FeeApplicability;

  /** Explicitly nullable: widening a section-scoped structure back to the
   * whole class needs `null` to be *sent*. Omitting the key leaves the
   * column untouched, so an omitted-when-empty payload silently kept the
   * old section. `@IsOptional()` skips `null` as well as `undefined`, so
   * the `@IsUUID()` check still applies to every non-null value. */
  @IsOptional()
  @IsUUID()
  section_id?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class QueryFeeStructureDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class CreatePaymentDto {
  @IsUUID()
  student_id: string;

  @IsNumber()
  @Min(0)
  total_amount: number;

  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @IsOptional()
  @IsEnum(PaymentStatus)
  payment_status?: PaymentStatus;

  @IsOptional()
  @IsString()
  transaction_reference?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  remarks?: string;

  @IsOptional()
  @IsDateString()
  payment_date?: string;
}

export class PaymentAllocationInputDto {
  @IsUUID()
  student_fee_id: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  allocated_amount: number;

  @IsEnum(PaymentAllocationType)
  allocation_type: PaymentAllocationType;
}

export class RecordPaymentWithAllocationDto {
  @IsUUID()
  student_id: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  total_amount: number;

  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationInputDto)
  allocations: PaymentAllocationInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transaction_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  generate_invoice?: boolean;
}

export class QueryPaymentDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class GenerateStudentFeesDto {
  @IsUUID()
  academic_year_id: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;
}

export class GenerateFeesResultDto {
  generated: number;
  skipped: number;
  students_evaluated: number;
}

export class QueryFeeDuesDto {
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsIn([FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID])
  status?: FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID;

  @IsOptional()
  @IsIn(['due_amount', 'name', 'class'])
  sort_by?: FeeDuesSortBy;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: SortOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class QueryFlaggedDuesDto {
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

/**
 * Family-facing view of a payment allocation. Allow-list, not deny-list:
 * `notes` is internal staff free text (same category as `Payment.remarks`)
 * and the `payment` back-reference is redundant inside a payment's own
 * response.
 */
export class FamilyPaymentAllocationDto {
  id: string;
  student_fee_id: string;
  allocated_amount: number;
  allocation_type: PaymentAllocationType;
}

/**
 * Family-facing view of a payment [5.1].
 *
 * `GET /payments/student/:studentId` and
 * `GET /payments/invoices/student/:studentId` are open to PARENT/STUDENT
 * since [5.1]. The raw `Payment` entity carries material a family must not
 * see:
 *
 * - `remarks` — internal free text staff write about the transaction
 * - `received_by_user_id` / `received_by` — which staff member took the
 *   money, and (if the relation is ever joined) that user's full record
 *
 * This is deliberately an **allow-list**: a column added to `Payment` later
 * stays out of family responses until someone adds it here on purpose.
 * Staff responses are unaffected — they keep receiving the entity.
 */
export class FamilyPaymentDto {
  id: string;
  student_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  transaction_reference: string | null;
  invoice_id: string | null;
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
    payment_date: payment.payment_date,
    created_at: payment.created_at,
    ...(payment.allocations
      ? {
          allocations: payment.allocations.map((a) => ({
            id: a.id,
            student_fee_id: a.student_fee_id,
            allocated_amount: a.allocated_amount,
            allocation_type: a.allocation_type,
          })),
        }
      : {}),
  };
}

/**
 * Family-facing view of a monthly fee row [5.1].
 *
 * Allow-list. The field this exists to withhold is `reminder_threshold_date`
 * — internal dunning plumbing recording when the school's reminder job would
 * chase this fee. It is not something a family can act on, and it exposes
 * the school's collection policy.
 *
 * `original_advance_month`/`original_advance_year` are also withheld:
 * internal bookkeeping for how an advance payment was re-dated.
 *
 * Reused by every family surface that returns a StudentFee — the invoice's
 * `student_fee` relation and `getInvoiceSummary`'s `fee_breakdown` — so the
 * two cannot drift apart.
 */
export class FamilyStudentFeeDto {
  id: string;
  student_id: string;
  academic_year_id: string;
  month: number;
  year: number;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  status: FeeStatus;
  due_date: Date | null;
  is_advance_payment: boolean;
}

export function toFamilyStudentFee(fee: StudentFee): FamilyStudentFeeDto {
  return {
    id: fee.id,
    student_id: fee.student_id,
    academic_year_id: fee.academic_year_id,
    month: fee.month,
    year: fee.year,
    total_amount: fee.total_amount,
    paid_amount: fee.paid_amount,
    discount_amount: fee.discount_amount,
    status: fee.status,
    due_date: fee.due_date,
    is_advance_payment: fee.is_advance_payment,
  };
}

/**
 * Family-facing view of one open due inside `GET /fees/dues` [5.1].
 *
 * Same withholding as `FamilyStudentFeeDto` — `DueEntry` carries
 * `reminder_threshold_date` too.
 */
export class FamilyDueEntryDto {
  student_fee_id: string;
  month: number;
  year: number;
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
      month: due.month,
      year: due.year,
      total_amount: due.total_amount,
      paid_amount: due.paid_amount,
      discount_amount: due.discount_amount,
      balance: due.balance,
      status: due.status,
      due_date: due.due_date,
    })),
  };
}

/**
 * Family-facing view of a fee structure [5.1] — the school's published price
 * list.
 *
 * The field this exists to withhold is `selected_students`. A
 * SELECTED-applicability structure links to the *specific students* it
 * applies to, and `FeeStructureService.findOne` eager-loads
 * `selected_students.student` in full for the staff edit dialog's student
 * picker. Returning that raw to a family caller would let any parent read
 * unrelated children's `full_name`, `date_of_birth`, `gender`,
 * `home_address`, `registration_number` and `user_id` — a cross-family PII
 * leak, reachable purely by listing `/fee-structures` for ids.
 *
 * `findAll` never loads that relation, but both list and detail are shaped
 * through this DTO anyway: allow-list discipline means a relation added to
 * `findAll` later stays out of family responses until someone opts it in.
 */
export class FamilyFeeStructureDto {
  id: string;
  fee_type: FeeType;
  name: string;
  amount: number;
  applicability: FeeApplicability;
  class_id: string;
  section_id: string | null;
  academic_year_id: string;
  month: number;
  is_recurring: boolean;
}

export function toFamilyFeeStructure(structure: FeeStructure): FamilyFeeStructureDto {
  return {
    id: structure.id,
    fee_type: structure.fee_type,
    name: structure.name,
    amount: structure.amount,
    applicability: structure.applicability,
    class_id: structure.class_id,
    section_id: structure.section_id,
    academic_year_id: structure.academic_year_id,
    month: structure.month,
    is_recurring: structure.is_recurring,
  };
}

/**
 * Swagger-only mirrors of the staff `GET /fees/dues` payload [5.1 review].
 *
 * `getDues` returns a role-dependent union (staff rows vs. `FamilyStudentDueDto`),
 * which defeats the Nest swagger plugin's return-type inference — the route
 * generated as an untyped body. The controller now declares the union
 * explicitly with `getSchemaPath`, and that needs the staff variant to exist
 * as a *class* the plugin can emit; `DueEntry`/`StudentDueSummary` are plain
 * interfaces on `FeeDuesService` and are erased at compile time.
 *
 * `implements` is what keeps these honest: adding a field to the service
 * interface fails the build here until it is mirrored, so the published
 * contract cannot silently drift from the runtime shape.
 */
export class StaffDueEntryDto implements DueEntry {
  student_fee_id: string;
  month: number;
  year: number;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  balance: number;
  status: FeeStatus;
  due_date: Date | null;
  reminder_threshold_date: Date | null;
}

export class StaffStudentDueDto implements StudentDueSummary {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
  dues: StaffDueEntryDto[];
}
