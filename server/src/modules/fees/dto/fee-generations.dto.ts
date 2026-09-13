import { IsOptional, IsUUID, IsEnum, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { FeeType, FeeGenerationSource } from '@biddaloy/shared';

export type CollectionStatus = 'NONE' | 'PARTIAL' | 'FULL';

export class QueryFeeGenerationsDto {
  @IsOptional()
  @IsDateString()
  period_from?: string;

  @IsOptional()
  @IsDateString()
  period_to?: string;

  @IsOptional()
  @IsEnum(FeeType)
  fee_type?: FeeType;

  @IsOptional()
  @IsEnum(FeeGenerationSource)
  source?: FeeGenerationSource;

  @IsOptional()
  @IsUUID()
  generated_by_user_id?: string;

  @IsOptional()
  @IsEnum(['NONE', 'PARTIAL', 'FULL'])
  collection_status?: CollectionStatus;

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
  limit?: number = 20;
}

export class QueryFeeGenerationBillsDto {
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
  limit?: number = 20;
}

/** Summary row returned by `GET /fees/generations`. */
export class FeeGenerationListItemDto {
  id: string;
  academic_year_id: string;
  period_start: string;
  period_type: string;
  due_date: string;
  source: string;
  duplicate_strategy: string;
  notify_families: boolean;
  student_count: number;
  generated_count: number;
  skipped_count: number;
  removed_count: number;
  created_at: string;
  /** Sum of every bill's `total_amount` this batch created. */
  billed_amount: number;
  /** Sum of every bill's `paid_amount` this batch created. */
  collected_amount: number;
  collection_status: CollectionStatus;
  generated_by: { id: string; full_name: string } | null;
}

/** Detail row returned by `GET /fees/generations/:id/bills`. */
export class FeeGenerationBillItemDto {
  id: string;
  student_id: string;
  student_full_name: string;
  student_registration_number: string | null;
  class_name: string | null;
  fee_name: string;
  amount: number;
  paid_amount: number;
  status: string;
  occurrence: string;
}
