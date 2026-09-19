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
  ArrayMaxSize,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
  FeeType,
  PaymentMethod,
  PaymentStatus,
  PaymentAllocationType,
  FeeStatus,
  PeriodType,
  DuplicateStrategy,
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

  /** Nullable: a school-wide structure has no class label. */
  @IsOptional()
  @IsUUID()
  class_id?: string | null;

  /** Nullable for the same reason as `class_id`:
   * "whole class" is an explicit `null`, not an absent key. */
  @IsOptional()
  @IsUUID()
  section_id?: string | null;

  @IsUUID()
  academic_year_id: string;
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

  /** Explicitly nullable: widening a class-scoped structure back to
   * school-wide needs `null` to be *sent*. Omitting the key leaves the
   * column untouched, so an omitted-when-empty payload silently kept the
   * old class. `@IsOptional()` skips `null` as well as `undefined`, so
   * the `@IsUUID()` check still applies to every non-null value. */
  @IsOptional()
  @IsUUID()
  class_id?: string | null;

  /** Explicitly nullable: widening a section-scoped structure back to the
   * whole class needs `null` to be *sent*. Omitting the key leaves the
   * column untouched, so an omitted-when-empty payload silently kept the
   * old section. `@IsOptional()` skips `null` as well as `undefined`, so
   * the `@IsUUID()` check still applies to every non-null value. */
  @IsOptional()
  @IsUUID()
  section_id?: string | null;
}

export class QueryFeeStructureDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  /** Matches against name (ILIKE, escaped). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(FeeType)
  fee_type?: FeeType;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  // `@Type(() => Boolean)` is deliberately not used here: class-transformer's
  // Boolean coercion is `Boolean(value)`, which treats the *string*
  // `"false"` (what a query param actually is) as truthy — `?include_deleted=
  // false` would silently become `true`. This transform parses the two
  // literal strings a query param can actually carry.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  include_deleted?: boolean = false;

  @IsOptional()
  @IsEnum(['name', 'amount', 'created_at'])
  sort?: 'name' | 'amount' | 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';

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

  /** [16.1.6] Client-supplied idempotency key. A retried request with the
   * same key (per tenant) returns the payment already created for it
   * instead of recording a second one. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotency_key?: string;
}

export class QueryPaymentDto {
  /** Matches transaction reference or student name/registration number
   * (ILIKE, escaped — see `normalizeSearchTerm`). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsUUID()
  received_by_user_id?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  /** Only reversal payments (`reversal_of_payment_id IS NOT NULL`). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_reversal?: boolean;

  /** Reversed payments are excluded by default (a reversed payment and its
   * reversal both stay in the ledger, but showing both by default would
   * double-count on the list view). Pass `true` to include them. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  include_reversed?: boolean = false;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: SortOrder = 'DESC';

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
 * `GET /payments/:id` response — one payment with allocations enriched by
 * `fee_name`/`period_start` (joined from `student_fee` → `fee_structure` at
 * query time; `PaymentAllocation` itself carries neither column) plus the
 * student/invoice/staff context a list row doesn't need.
 */
export class PaymentDetailAllocationDto {
  id: string;
  student_fee_id: string;
  allocated_amount: number;
  allocation_type: PaymentAllocationType;
  discount_amount: number;
  /** Null when the `student_fee`/`fee_structure` behind this allocation was
   * soft-deleted after the payment was recorded. */
  fee_name: string | null;
  period_start: Date | null;
}

export class PaymentDetailInvoiceDto {
  id: string;
  invoice_number: string;
  status: string;
}

export class PaymentDetailUserDto {
  id: string;
  full_name: string;
}

export class PaymentDetailDto {
  id: string;
  student_id: string;
  student: { id: string; full_name: string } | null;
  total_amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  transaction_reference: string | null;
  payment_date: Date;
  remarks: string | null;
  invoice: PaymentDetailInvoiceDto | null;
  received_by: PaymentDetailUserDto | null;
  approved_by: PaymentDetailUserDto | null;
  reversal_of_payment_id: string | null;
  reversed_by_payment_id: string | null;
  allocations: PaymentDetailAllocationDto[];
  created_at: Date;
}

/**
 * [16.3.1] Explicit student × fee-structure × period generation — the
 * read-only half. Preview never writes and never notifies, so it carries
 * no `due_date`/`notify_families`/`duplicate_strategy`: those only matter
 * once bills are actually created.
 */
export class GenerateFeesPreviewDto {
  @IsUUID()
  academic_year_id: string;

  @IsDateString()
  period_start: string;

  @IsEnum(PeriodType)
  period_type: PeriodType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  student_ids: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  fee_structure_ids: string[];

  @IsOptional()
  @IsBoolean()
  include_inactive?: boolean = false;
}

/** [16.3.1] Same targeting as the preview, plus what generation actually
 * needs to write bills and (optionally) notify families. */
export class GenerateFeesDto extends GenerateFeesPreviewDto {
  /** Defaults to `period_start` + 9 days when omitted (service-computed,
   * not defaulted here, since it depends on `period_start`). */
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsEnum(DuplicateStrategy)
  duplicate_strategy?: DuplicateStrategy = DuplicateStrategy.SKIP;

  /** Omitted → the tenant's `settings.fees.notifyOnManualGenerationDefault`
   * decides (service-resolved, not defaulted here). */
  @IsOptional()
  @IsBoolean()
  notify_families?: boolean;
}

/** A skipped-for-being-inactive student, named for the UI's review step. */
export class InactiveStudentDto {
  id: string;
  full_name: string;
}

/** One (student, fee structure) pair that already has a bill for this
 * period — what "duplicate" means for this generation request. */
export class DuplicateBillDto {
  student_id: string;
  fee_structure_id: string;
  existing_bill_id: string;
  paid_amount: number;
}

export class GenerateFeesPreviewResultDto {
  students_total: number;
  inactive: InactiveStudentDto[];
  duplicates: DuplicateBillDto[];
  /** How many bills a `POST /fees/generate` with the same selection and
   * `duplicate_strategy: SKIP` would actually create. */
  would_generate: number;
}

export class GenerateFeesResultDto {
  fee_generation_id: string;
  student_count: number;
  generated_count: number;
  skipped_count: number;
  removed_count: number;
  inactive_skipped: InactiveStudentDto[];
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

  /** Narrows to students with at least one open bill against a fee
   * structure of this type — same "narrows students, not the dues[]
   * breakdown" behavior as `month`/`year` above. */
  @IsOptional()
  @IsEnum(FeeType)
  fee_type?: FeeType;

  /** Matches against student full_name, registration_number (ILIKE, escaped),
   * or roll_number (exact, Bengali-digit-aware). Applied at the SQL stage
   * that produces matching student IDs — never as a post-aggregation
   * filter, which would corrupt total/totalPages. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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
  fee_structure_id: string;
  fee_name: string;
  fee_type: FeeType;
  month: number;
  year: number;
  period_start: Date;
  period_type: PeriodType;
  occurrence: number;
  is_late_fee: boolean;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
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
