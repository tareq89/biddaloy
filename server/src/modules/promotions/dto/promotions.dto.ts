import {
  IsUUID,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  ArrayMinSize,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateIf,
  ArrayMaxSize,
  ArrayUnique,
  IsInt,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';

/** The outcomes `commit` handles. CONDITIONAL moves up like PROMOTE (#2296). */
export const COMMITTABLE_PROMOTION_OUTCOMES: PromotionOutcome[] = [
  PromotionOutcome.PROMOTE,
  PromotionOutcome.RETAIN,
  PromotionOutcome.GRADUATE,
  PromotionOutcome.CONDITIONAL,
];

export class CreatePromotionRunDto {
  @IsUUID()
  source_class_id: string;

  @IsUUID()
  target_academic_year_id: string;

  @IsOptional()
  @IsUUID()
  target_class_id?: string;

  // Exactly one merit source: the exam list or a PUBLISHED final result (70.3.3).
  // A field that is sent (not null) is always validated; null counts as absent; the service enforces the XOR (422, fixed sentence).
  @ValidateIf((o: CreatePromotionRunDto) => o.exam_ids != null || o.final_result_id == null)
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  exam_ids?: string[];

  @ValidateIf((o: CreatePromotionRunDto) => o.final_result_id != null || o.exam_ids == null)
  @IsUUID()
  final_result_id?: string;

  @IsEnum(PlacementAlgorithm)
  algorithm: PlacementAlgorithm;
}

export class PatchPromotionEntryDto {
  @IsUUID()
  student_id: string;

  @IsOptional()
  @IsIn(COMMITTABLE_PROMOTION_OUTCOMES, {
    message: `final_outcome must be one of: ${COMMITTABLE_PROMOTION_OUTCOMES.join(', ')}`,
  })
  final_outcome?: PromotionOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  group_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  override_note?: string;
}

export class SuggestTargetQueryDto {
  @IsUUID()
  source_class_id: string;

  @IsUUID()
  target_academic_year_id: string;
}

export class ListPromotionRunsQueryDto {
  @IsOptional()
  @IsUUID()
  source_class_id?: string;
}

/** [69.4.01] Filters and paging for `GET promotions/:id/groups`; all filtering is server-side. */
export class ListPromotionGroupsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  gpa_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  gpa_max?: number;

  /** Required with `marks_min`: the minimum applies to this subject's marks. */
  @ValidateIf(
    (o: ListPromotionGroupsQueryDto) => o.subject_code !== undefined || o.marks_min !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  subject_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  marks_min?: number;

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
  limit?: number = 50;
}

/** [69.4.01] Bulk group set; `group_name: null` clears the group. */
export class SetPromotionGroupsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  entry_ids: string[];

  @ValidateIf((o: SetPromotionGroupsDto) => o.group_name !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  group_name: string | null;
}
