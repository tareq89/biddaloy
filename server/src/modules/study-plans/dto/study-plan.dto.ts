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
import { STUDY_PLAN_LIMITS } from '@biddaloy/shared';
import type { StudyPlanExamMarker, StudyPlanLesson } from '@biddaloy/shared';

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

/** Fields every plan DTO carries (D44: `section.class_id`, `academic_year_id`). */
export interface StudyPlanBaseDto {
  id: string;
  academic_year_id: string;
  section: { id: string; name: string; class_id: string; class_name: string };
  subject: { id: string; name_en: string; name_bn: string | null; code: string };
  term: { id: string; name: string } | null;
  lesson_count: number;
}

export interface StudyPlanDetailDto extends StudyPlanBaseDto {
  owners: { teacher_id: string; full_name: string }[];
  owner_override_teacher_id: string | null;
  can_edit: boolean;
  lessons: StudyPlanLesson[];
  exam_markers: (StudyPlanExamMarker & { exam_name: string })[];
  /** Only on a lesson replace: markers dropped because their lesson was removed. */
  dropped_markers?: StudyPlanExamMarker[];
}

export interface StudyPlanListDto {
  data: StudyPlanBaseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
