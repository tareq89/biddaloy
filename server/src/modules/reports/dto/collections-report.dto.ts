import { IsDateString, IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@biddaloy/shared';

/**
 * [16.6.2] Query for `GET /reports/collections` and
 * `GET /reports/collections.csv`. `from`/`to` are `YYYY-MM-DD` calendar
 * days in the school's own timezone (Asia/Dhaka, D14) — see
 * `startOfDayInSchoolTimezone`/`endOfDayInSchoolTimezone` in
 * `collections-report.service.ts` for how they're turned into UTC
 * instants.
 */
export class CollectionsReportQueryDto {
  // `@IsDateString()` accepts a full ISO timestamp (e.g. `2026-03-01T00:00Z`),
  // which `endOfDayInSchoolTimezone` then mishandles (`new Date(`${v}T00:00:00Z`)`
  // becomes an invalid instant) and throws a RangeError -> 500 instead of a
  // clean 400. Require a bare `YYYY-MM-DD` calendar day instead.
  @ApiProperty({ example: '2026-03-01' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a YYYY-MM-DD calendar date' })
  from: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a YYYY-MM-DD calendar date' })
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  received_by_user_id?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;
}

export class CollectionsReportRange {
  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;
}

export class CollectionsReportTotals {
  @ApiProperty()
  collected: number;

  @ApiProperty()
  reversed: number;

  @ApiProperty()
  net: number;

  @ApiProperty()
  standing_discount: number;

  @ApiProperty()
  one_off_discount: number;

  @ApiProperty()
  wallet_used: number;

  @ApiProperty()
  wallet_added: number;

  @ApiProperty()
  change_returned: number;
}

export class CollectionsByMethod {
  @ApiProperty({ enum: PaymentMethod })
  payment_method: PaymentMethod;

  @ApiProperty()
  count: number;

  @ApiProperty()
  collected: number;

  @ApiProperty()
  reversed: number;

  @ApiProperty()
  net: number;
}

export class CollectionsByCollector {
  @ApiProperty({ nullable: true, type: String })
  user_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  full_name: string | null;

  @ApiProperty()
  count: number;

  @ApiProperty()
  collected: number;

  @ApiProperty()
  reversed: number;

  @ApiProperty()
  net: number;
}

export class CollectionsByFeeType {
  @ApiProperty()
  fee_type: string;

  @ApiProperty()
  collected: number;

  @ApiProperty()
  discount: number;
}

export class CollectionsByDay {
  @ApiProperty()
  date: string;

  @ApiProperty()
  collected: number;

  @ApiProperty()
  reversed: number;

  @ApiProperty()
  net: number;
}

export class CollectionsReportDto {
  @ApiProperty({ type: CollectionsReportRange })
  range: CollectionsReportRange;

  @ApiProperty({ type: CollectionsReportTotals })
  totals: CollectionsReportTotals;

  @ApiProperty({ type: CollectionsByMethod, isArray: true })
  by_method: CollectionsByMethod[];

  @ApiProperty({ type: CollectionsByCollector, isArray: true })
  by_collector: CollectionsByCollector[];

  @ApiProperty({ type: CollectionsByFeeType, isArray: true })
  by_fee_type: CollectionsByFeeType[];

  @ApiProperty({ type: CollectionsByDay, isArray: true })
  by_day: CollectionsByDay[];
}

/** One row of the `GET /reports/collections.csv` export — one payment. */
export interface CollectionsCsvRow {
  date: string;
  invoice_number: string;
  student_name: string;
  payment_method: PaymentMethod;
  transaction_reference: string | null;
  collector_name: string | null;
  amount: number;
  discount: number;
  is_reversal: boolean;
}
