import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExamComponentKind, ExamKind } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `numeric(6,2)` column range. */
const MAX_MARKS = 9999.99;

export class CreateExamTemplateDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsEnum(ExamKind)
  kind: ExamKind;
}

export class ExamTemplateComponentInputDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsEnum(ExamComponentKind)
  kind: ExamComponentKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MARKS)
  full: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MARKS)
  pass: number;
}

export class ExamTemplateRowInputDto {
  @IsInt()
  @Min(1)
  @Max(99)
  classGrade: number;

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  subjectCode: string;

  /** Order in the array is the component `sequence`. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamTemplateComponentInputDto)
  components: ExamTemplateComponentInputDto[];
}

export class UpdateExamTemplateDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsEnum(ExamKind)
  kind?: ExamKind;

  /** When present, replaces ALL component rows of the template. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamTemplateRowInputDto)
  rows?: ExamTemplateRowInputDto[];
}

export class ExamTemplateSummaryDto {
  id: string;
  name: string;
  kind: ExamKind;
  rowCount: number;
  classGrades: number[];
}

export class ExamTemplateComponentDto {
  name: string;
  kind: ExamComponentKind;
  full: number;
  pass: number;
  sequence: number;
}

export class ExamTemplateRowDto {
  classGrade: number;
  subjectCode: string;
  subjectName: string | null;
  components: ExamTemplateComponentDto[];
}

export class ExamTemplateDetailDto {
  id: string;
  name: string;
  kind: ExamKind;
  rows: ExamTemplateRowDto[];
}
