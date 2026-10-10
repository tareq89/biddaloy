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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';

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

// ---------------------------------------------------------------- responses

/** A stored template lesson (`StudyPlanTemplateLesson`): never a topic link. */
export class StudyPlanTemplateLessonItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() periods: number;
  @ApiPropertyOptional({ description: 'Left out for PARENT and STUDENT callers (D20).' })
  notes?: string;
}

export class StudyPlanTemplateSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() class_grade: number;
  @ApiProperty() subject_code: string;
  @ApiProperty({ nullable: true, type: String }) subject_name: string | null;
  @ApiProperty() lesson_count: number;
  @ApiProperty() total_periods: number;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
}

export class StudyPlanTemplateDetailDto extends StudyPlanTemplateSummaryDto {
  @ApiProperty({ type: [StudyPlanTemplateLessonItemDto] })
  lessons: StudyPlanTemplateLessonItemDto[];
}

export class StudyPlanTemplateListDto {
  @ApiProperty({ type: [StudyPlanTemplateSummaryDto] }) data: StudyPlanTemplateSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
