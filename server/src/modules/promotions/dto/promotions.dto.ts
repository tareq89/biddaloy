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
} from 'class-validator';
import { PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';

/**
 * [68.1.fix] The outcomes `commit` actually handles. `CONDITIONAL` is in the shared enum
 * (#2208) but commit only builds PROMOTE/RETAIN/GRADUATE lists, so a CONDITIONAL student
 * would get no next-year enrollment. Refused here and in the workbook tab until #2296
 * teaches commit to move it like PROMOTE; #2296 widens this list back.
 */
export const COMMITTABLE_PROMOTION_OUTCOMES: PromotionOutcome[] = [
  PromotionOutcome.PROMOTE,
  PromotionOutcome.RETAIN,
  PromotionOutcome.GRADUATE,
];

export class CreatePromotionRunDto {
  @IsUUID()
  source_class_id: string;

  @IsUUID()
  target_academic_year_id: string;

  @IsOptional()
  @IsUUID()
  target_class_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  exam_ids: string[];

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
