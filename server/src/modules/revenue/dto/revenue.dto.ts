import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class RevenueQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Invalid month' })
  month?: string;

  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';

  /** Opaque; the server validates it and answers a fixed 400 if it is not one of its own. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export interface RevenueSchoolRow {
  school_id: string;
  school: string;
  seat_income_paisa: number;
  package_income_paisa: number;
  refunds_paisa: number;
  net_paisa: number;
}

export interface NotRenewedRow {
  school_id: string;
  name: string;
  paid_until: string;
  days_since_ended: number;
  plan: string | null;
}

export interface RevenueReport {
  month: string;
  seat_income_paisa: number;
  package_income_paisa: number;
  /** Refunds that happened in the month (any order month), shown on their own line. */
  refunds_paisa: number;
  net_paisa: number;
  paying_schools: number;
  not_renewed: { items: NotRenewedRow[]; next_cursor: string | null };
}
