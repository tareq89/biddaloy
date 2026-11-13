import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ActionLineDto, SmsProviderBalanceDto } from '@biddaloy/shared';

export const REPORT_PAGE_MAX = 100;
/** The CSV is one query; past this many school rows it stops (D18: a cap, not a failure). */
export const CSV_ROW_CAP = 20_000;

export class SmsStateReportQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format: 'json' | 'csv' = 'json';

  @ApiPropertyOptional({ minimum: 1, maximum: REPORT_PAGE_MAX, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REPORT_PAGE_MAX)
  limit: number = 50;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page (margin, school id).' })
  @IsOptional()
  @IsString()
  after?: string;
}

/** Whole SMS and whole paisa everywhere (Rule 26). Strings are never used for numbers. */
export interface SmsStateTotalsDto {
  boughtSms: number;
  soldSms: number;
  usedSms: number;
  expiredSms: number;
  promisedUnusedSms: number;
  /** bought minus sold; negative means oversold. */
  unsoldSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
}

export interface SmsStatePackageRowDto {
  catalogId: string;
  name: string;
  orders: number;
  soldSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
}

export interface SmsStateSchoolRowDto {
  schoolId: string;
  schoolName: string;
  orders: number;
  soldSms: number;
  usedSms: number;
  expiredSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
  /** Last 30 days, SMS messages only. */
  failedSms: number;
  sentSms: number;
  /** Failed over (failed + accepted), in basis points; null when nothing was sent. */
  failureRateBp: number | null;
}

export class SmsStateReportDto {
  @ApiProperty() actionLines: ActionLineDto[];
  @ApiProperty() balance: SmsProviderBalanceDto;
  @ApiProperty() totals: SmsStateTotalsDto;
  @ApiProperty() packages: SmsStatePackageRowDto[];
  @ApiProperty() schools: SmsStateSchoolRowDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
}
