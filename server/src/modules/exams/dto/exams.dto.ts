import {
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsNotEmpty,
  IsEnum,
  IsNumberString,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { ExamKind, ExamStatus, ExamComponentKind, ExamComponentSource } from '@biddaloy/shared';

// --- Exams ---

export class CreateExamDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsNotEmpty()
  @IsEnum(ExamKind)
  kind: ExamKind;

  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;

  @IsNotEmpty()
  @IsUUID()
  class_id: string;

  @IsOptional()
  @IsUUID()
  academic_term_id?: string | null;
}

export class UpdateExamDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsEnum(ExamKind)
  kind?: ExamKind;

  // Class/academic-year change is rejected in the service once any Mark
  // exists for the exam (issue's rule #1) — the DTO only checks shape.
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  academic_term_id?: string | null;

  @IsOptional()
  @IsEnum(ExamStatus)
  status?: ExamStatus;
}

export class QueryExamDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

// --- Exam components ---

export class CreateExamComponentDto {
  @IsNotEmpty()
  @IsUUID()
  subject_id: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsNotEmpty()
  @IsEnum(ExamComponentKind)
  kind: ExamComponentKind;

  @IsOptional()
  @IsEnum(ExamComponentSource)
  source?: ExamComponentSource;

  @IsNotEmpty()
  @IsNumberString()
  full_marks: string;

  @IsOptional()
  @IsNumberString()
  pass_marks?: string | null;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  sequence: number;
}

export class UpdateExamComponentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsEnum(ExamComponentKind)
  kind?: ExamComponentKind;

  @IsOptional()
  @IsEnum(ExamComponentSource)
  source?: ExamComponentSource;

  @IsOptional()
  @IsNumberString()
  full_marks?: string;

  @IsOptional()
  @IsNumberString()
  pass_marks?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;
}

export class QueryExamComponentDto {
  @IsOptional()
  @IsUUID()
  subject_id?: string;
}

export class CopyExamComponentsDto {
  // Source is either another subject in the same exam (same exam_id,
  // different source_subject_id) or the same subject in another exam
  // (different source_exam_id, same subject).
  @IsNotEmpty()
  @IsUUID()
  source_exam_id: string;

  @IsNotEmpty()
  @IsUUID()
  source_subject_id: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  target_subject_ids: string[];
}

// --- Subject choices ---

export class SetSubjectChoiceDto {
  @IsNotEmpty()
  @IsUUID()
  class_subject_id: string;

  @IsOptional()
  is_fourth?: boolean;
}

// `class_id` isn't a query param here (unlike exams/components lists) —
// the student's class is derived from their own `class_section_id`
// (`SubjectChoicesService.listOptions`), so accepting a caller-supplied
// class would be either redundant or a way to ask about the wrong class.
export class QuerySubjectChoiceDto {
  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;
}
