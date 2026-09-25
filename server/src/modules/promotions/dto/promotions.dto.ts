import {
  IsUUID,
  IsOptional,
  IsEnum,
  IsArray,
  ArrayMinSize,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';

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
  @IsEnum(PromotionOutcome)
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
