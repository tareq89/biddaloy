import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import type { AcrAssessmentStatus } from '../entities/acr-assessment.entity';

/** `POST /acr/assessments`. Form version is chosen server-side (latest). 28.2.2. */
export class StartAcrAssessmentDto {
  @IsUUID()
  user_id: string;

  @IsUUID()
  academic_year_id: string;
}

export class AcrScoreInputDto {
  @IsUUID()
  criterion_id: string;

  // Service re-checks; kept here so bad input 400s before any DB work.
  @IsInt()
  @IsIn([4, 3, 2, 1])
  score: number;
}

/** Autosave body. There is deliberately NO `total` field: it is server-computed (D4). */
export class UpdateAcrAssessmentDto {
  @IsOptional()
  @IsObject()
  step1_data?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  step3_data?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AcrScoreInputDto)
  scores?: AcrScoreInputDto[];
}

export class ListAcrAssessmentsQueryDto {
  @IsOptional()
  @IsUUID()
  year?: string;

  @IsOptional()
  @IsIn(['INCOMPLETE', 'COMPLETED'])
  status?: AcrAssessmentStatus;
}

export class AcrAssessmentResponseDto {
  id: string;
  user_id: string;
  academic_year_id: string;
  form_version_id: string;
  status: AcrAssessmentStatus;
  total: number | null;
  assessed_by: string;
  step1_data: Record<string, unknown> | null;
  step3_data: Record<string, unknown> | null;
  completed_at: Date | null;
  scores: { criterion_id: string; score: number }[];
}
