import { IsBoolean, IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { DuplicateStrategy } from '@biddaloy/shared';

/** [38.2.3] Shared targeting for both the fine-sweep preview and generate
 * routes: which month, and an optional class/section narrowing. */
export class FineSweepQueryDto {
  /** `'YYYY-MM'` — the calendar month the sweep evaluates and bills for. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;
}

export class FineSweepGenerateDto extends FineSweepQueryDto {
  @IsOptional()
  @IsEnum(DuplicateStrategy)
  duplicate_strategy?: DuplicateStrategy = DuplicateStrategy.SKIP;

  @IsOptional()
  @IsBoolean()
  notify_families?: boolean;
}

/** One student's fine for one rule — what `FineSweepService.compute()`
 * produces before it ever touches `student_fees`. */
export class FineSweepRowDto {
  student_id: string;
  rule_id: string;
  fee_structure_id: string;
  count: number;
  amount: number;
  note: string;
}

export class FineSweepDuplicateDto {
  student_id: string;
  fee_structure_id: string;
  existing_bill_id: string;
  paid_amount: number;
}

export class FineSweepPreviewResultDto {
  students: FineSweepRowDto[];
  total_amount: number;
  would_create: number;
  duplicates: FineSweepDuplicateDto[];
}

export class FineSweepGenerateResultDto {
  fee_generation_ids: string[];
  generated_count: number;
  skipped_count: number;
}
