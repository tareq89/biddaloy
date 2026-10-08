import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';

/**
 * [66.2.01/#2006] Lesson item. Structure only here; the limits (title 1-200,
 * periods 1-20, notes, unique ids, topic check) live in
 * `StudyPlansService.normalizeLessons` so the CSV commit, which calls the
 * service directly, gets the same checks.
 */
export class StudyPlanLessonDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  title: string;

  @IsInt()
  periods: number;

  @IsOptional()
  @IsUUID()
  topic_id?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateStudyPlanDto {
  @IsUUID()
  section_id: string;

  @IsUUID()
  subject_id: string;

  @ValidateIf((o: CreateStudyPlanDto) => o.academic_term_id !== null)
  @IsUUID()
  academic_term_id: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STUDY_PLAN_LIMITS.maxLessons)
  @ValidateNested({ each: true })
  @Type(() => StudyPlanLessonDto)
  lessons?: StudyPlanLessonDto[];
}

export class UpdateStudyPlanDto {
  @ValidateIf((o: UpdateStudyPlanDto) => o.owner_override_teacher_id !== null)
  @IsUUID()
  owner_override_teacher_id: string | null;
}

export class ReplaceLessonsDto {
  @IsArray()
  @ArrayMaxSize(STUDY_PLAN_LIMITS.maxLessons)
  @ValidateNested({ each: true })
  @Type(() => StudyPlanLessonDto)
  lessons: StudyPlanLessonDto[];
}

export class ExamMarkerDto {
  @IsUUID()
  exam_id: string;

  @IsString()
  up_to_lesson_id: string;
}

export class SetExamMarkersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExamMarkerDto)
  markers: ExamMarkerDto[];
}

export class CopyToSectionDto {
  @IsUUID()
  section_id: string;
}

export class ListStudyPlansQueryDto {
  @IsOptional() @IsUUID() class_id?: string;
  @IsOptional() @IsUUID() section_id?: string;
  @IsOptional() @IsUUID() subject_id?: string;
  @IsOptional() @IsUUID() academic_term_id?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

// ---------------------------------------------------------------- responses

export class StudyPlanSectionRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() class_id: string;
  @ApiProperty() class_name: string;
}

export class StudyPlanSubjectRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name_en: string;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
  @ApiProperty() code: string;
}

export class StudyPlanTermRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

/** Fields every plan DTO carries (D44: `section.class_id`, `academic_year_id`). */
export class StudyPlanBaseDto {
  @ApiProperty() id: string;
  @ApiProperty() academic_year_id: string;
  @ApiProperty({ type: StudyPlanSectionRefDto }) section: StudyPlanSectionRefDto;
  @ApiProperty({ type: StudyPlanSubjectRefDto }) subject: StudyPlanSubjectRefDto;
  @ApiProperty({ nullable: true, type: StudyPlanTermRefDto }) term: StudyPlanTermRefDto | null;
  @ApiProperty() lesson_count: number;
}

/** A stored lesson (`StudyPlanLesson`): the id is always set on the way out. */
export class StudyPlanLessonItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() periods: number;
  @ApiPropertyOptional() topic_id?: string;
  @ApiPropertyOptional({ description: 'Teacher notes; never sent to families (D20).' })
  notes?: string;
}

export class StudyPlanOwnerDto {
  @ApiProperty() teacher_id: string;
  @ApiProperty() full_name: string;
}

export class StudyPlanExamMarkerItemDto {
  @ApiProperty() exam_id: string;
  @ApiProperty() up_to_lesson_id: string;
}

export class StudyPlanExamMarkerDetailDto extends StudyPlanExamMarkerItemDto {
  @ApiProperty() exam_name: string;
}

export class StudyPlanDetailDto extends StudyPlanBaseDto {
  @ApiProperty({ type: [StudyPlanOwnerDto] }) owners: StudyPlanOwnerDto[];
  @ApiProperty({ nullable: true, type: String }) owner_override_teacher_id: string | null;
  @ApiProperty() can_edit: boolean;
  @ApiProperty({ type: [StudyPlanLessonItemDto] }) lessons: StudyPlanLessonItemDto[];
  @ApiProperty({ type: [StudyPlanExamMarkerDetailDto] })
  exam_markers: StudyPlanExamMarkerDetailDto[];
  @ApiPropertyOptional({
    type: [StudyPlanExamMarkerItemDto],
    description: 'Only on a lesson replace: markers dropped because their lesson was removed.',
  })
  dropped_markers?: StudyPlanExamMarkerItemDto[];
}

export class StudyPlanListDto {
  @ApiProperty({ type: [StudyPlanBaseDto] }) data: StudyPlanBaseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
