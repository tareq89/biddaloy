import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
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
  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString()
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

export interface CollectionsReportRange {
  from: string;
  to: string;
}

export interface CollectionsReportTotals {
  collected: number;
  reversed: number;
  net: number;
  standing_discount: number;
  one_off_discount: number;
  wallet_used: number;
  wallet_added: number;
  change_returned: number;
}

export interface CollectionsByMethod {
  payment_method: PaymentMethod;
  count: number;
  collected: number;
  reversed: number;
  net: number;
}

export interface CollectionsByCollector {
  user_id: string | null;
  full_name: string | null;
  count: number;
  collected: number;
  reversed: number;
  net: number;
}

export interface CollectionsByFeeType {
  fee_type: string;
  collected: number;
  discount: number;
}

export interface CollectionsByDay {
  date: string;
  collected: number;
  reversed: number;
  net: number;
}

export class CollectionsReportDto {
  @ApiProperty()
  range: CollectionsReportRange;

  @ApiProperty()
  totals: CollectionsReportTotals;

  @ApiProperty({ isArray: true })
  by_method: CollectionsByMethod[];

  @ApiProperty({ isArray: true })
  by_collector: CollectionsByCollector[];

  @ApiProperty({ isArray: true })
  by_fee_type: CollectionsByFeeType[];

  @ApiProperty({ isArray: true })
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
