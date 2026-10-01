import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class SurveyAnswerInputDto {
  @IsUUID()
  questionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @SanitizeText()
  text?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;
}

export class RespondSurveyDto {
  @IsUUID()
  teacherId: string;

  @IsUUID()
  subjectId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerInputDto)
  answers: SurveyAnswerInputDto[];
}

/** Privacy contract for GET /surveys/:id/results: no respondent field exists on any of these. */
export interface SurveyHiddenResult {
  teacherId: string;
  subjectId: string;
  count: number;
  hidden: true;
}

export interface SurveyQuestionResult {
  questionId: string;
  text: string;
  averageStars: number | null;
  comments: string[];
}

export interface SurveyVisibleResult {
  teacherId: string;
  subjectId: string;
  count: number;
  hidden: false;
  questions: SurveyQuestionResult[];
}

export type SurveyPairResult = SurveyHiddenResult | SurveyVisibleResult;

/** Response shapes for `GET /surveys/mine` (documentation only; typed client reads these). */
export class PendingPairDto {
  @ApiProperty() teacherId: string;
  @ApiProperty() teacherName: string;
  @ApiProperty() subjectId: string;
  @ApiProperty() subjectName: string;
  @ApiProperty({ type: String, nullable: true }) subjectNameBn: string | null;
}

export class PendingSurveyQuestionDto {
  @ApiProperty() id: string;
  @ApiProperty() text: string;
  @ApiProperty() starsEnabled: boolean;
}

export class PendingSurveyDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() anonymous: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closesAt: Date | null;
  @ApiProperty({ type: [PendingSurveyQuestionDto] }) questions: PendingSurveyQuestionDto[];
  @ApiProperty({ type: [PendingPairDto] }) pending: PendingPairDto[];
}
