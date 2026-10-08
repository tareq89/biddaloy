import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';
import type { StudyPlanTemplateLesson } from '@biddaloy/shared';

/**
 * [66.2.06/#2011] Template lesson. No `topic_id` on purpose: the global
 * pipe forbids non-whitelisted fields, so a topic link is a 400. The limits
 * (title, periods, notes, unique ids) are checked in the service.
 */
export class StudyPlanTemplateLessonDto {
  @IsOptional() @IsString() id?: string;
  @IsString() title: string;
  @IsInt() periods: number;
  @IsOptional() @IsString() notes?: string;
}

export class CreateStudyPlanTemplateDto {
  @IsString() @Length(1, STUDY_PLAN_LIMITS.templateNameMax) name: string;
  @IsInt() @Min(1) @Max(12) class_grade: number;
  @IsString() @Length(1, 20) subject_code: string;

  @IsArray()
  @ArrayMaxSize(STUDY_PLAN_LIMITS.maxLessons)
  @ValidateNested({ each: true })
  @Type(() => StudyPlanTemplateLessonDto)
  lessons: StudyPlanTemplateLessonDto[];
}

export class UpdateStudyPlanTemplateDto {
  @IsOptional() @IsString() @Length(1, STUDY_PLAN_LIMITS.templateNameMax) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) class_grade?: number;
  @IsOptional() @IsString() @Length(1, 20) subject_code?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STUDY_PLAN_LIMITS.maxLessons)
  @ValidateNested({ each: true })
  @Type(() => StudyPlanTemplateLessonDto)
  lessons?: StudyPlanTemplateLessonDto[];
}

export class FromPlanDto {
  @IsOptional() @IsString() @MaxLength(STUDY_PLAN_LIMITS.templateNameMax) name?: string;
}

export class CopyStudyPlanTemplateDto {
  @IsUUID() section_id: string;
  @IsUUID() subject_id: string;

  @ValidateIf((o: CopyStudyPlanTemplateDto) => o.academic_term_id !== null)
  @IsUUID()
  academic_term_id: string | null;
}

export class ListStudyPlanTemplatesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) class_grade?: number;
  @IsOptional() @IsString() @MaxLength(20) subject_code?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export interface StudyPlanTemplateSummaryDto {
  id: string;
  name: string;
  class_grade: number;
  subject_code: string;
  subject_name: string | null;
  lesson_count: number;
  total_periods: number;
  updated_at: Date;
}

export interface StudyPlanTemplateDetailDto extends StudyPlanTemplateSummaryDto {
  lessons: StudyPlanTemplateLesson[];
}

export interface StudyPlanTemplateListDto {
  data: StudyPlanTemplateSummaryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
