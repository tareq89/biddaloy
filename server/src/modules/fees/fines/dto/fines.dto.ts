import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsDateString,
  ArrayMinSize,
  ArrayMaxSize,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FeeStatus, FeeType } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** [38.2.3] `POST /fees/fines` — log a fine for one or many students against
 * a FINE-type fee structure. */
export class LogFineDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  student_ids: string[];

  @IsUUID()
  fee_structure_id: string;

  /** Defaults to the structure's own `amount` when omitted. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @IsString()
  @SanitizeText()
  @MinLength(3)
  @MaxLength(280)
  note: string;

  @IsDateString()
  incident_date: string;

  @IsOptional()
  @IsBoolean()
  notify_families?: boolean = true;
}

export class LogFineResultDto {
  bill_ids: string[];
}

/** `POST /fees/fines/:id/waive` — waive all or part of one FINE bill. */
export class WaiveFineDto {
  /** Defaults to the bill's current outstanding balance when omitted. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @IsString()
  @SanitizeText()
  @MinLength(3)
  @MaxLength(280)
  reason: string;
}

export class WaiveFineResultDto {
  id: string;
  amount: number;
  status: FeeStatus;
}

export enum FineOrigin {
  RULE = 'RULE',
  MANUAL = 'MANUAL',
}

export class QueryFinesDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsUUID()
  fee_structure_id?: string;

  @IsOptional()
  @IsEnum(FineOrigin)
  origin?: FineOrigin;

  @IsOptional()
  @IsEnum(FeeStatus)
  status?: FeeStatus;

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

/** One FINE bill, staff view. */
export class StaffFineDto {
  id: string;
  student_id: string;
  fee_structure_id: string;
  fee_name: string;
  note: string | null;
  incident_date: Date | null;
  period_start: Date;
  total_amount: number;
  discount_amount: number;
  paid_amount: number;
  status: FeeStatus;
  due_date: Date | null;
  origin: FineOrigin;
  approved_by_user_id: string | null;
}

export class FineTotalsDto {
  charged: number;
  collected: number;
  waived: number;
  outstanding: number;
}

export class FinesListResultDto {
  items: StaffFineDto[];
  total: number;
  totals: FineTotalsDto;
}
