import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
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
export class SurveyHiddenResult {
  @ApiProperty() teacherId: string;
  @ApiProperty() subjectId: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: Boolean, enum: [true] }) hidden: true;
}

export class SurveyQuestionResult {
  @ApiProperty() questionId: string;
  @ApiProperty() text: string;
  @ApiProperty({ type: Number, nullable: true }) averageStars: number | null;
  @ApiProperty({ type: [String] }) comments: string[];
}

export class SurveyVisibleResult {
  @ApiProperty() teacherId: string;
  @ApiProperty() subjectId: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: Boolean, enum: [false] }) hidden: false;
  @ApiProperty({ type: [SurveyQuestionResult] }) questions: SurveyQuestionResult[];
}

export type SurveyPairResult = SurveyHiddenResult | SurveyVisibleResult;

/** `GET /surveys/:id/results`: one entry per teacher-subject pair, hidden below `minResponses`. */
export class SurveyResultsDto {
  @ApiProperty() surveyId: string;
  @ApiProperty() title: string;
  @ApiProperty() anonymous: boolean;
  @ApiProperty() minResponses: number;
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(SurveyHiddenResult) },
        { $ref: getSchemaPath(SurveyVisibleResult) },
      ],
    },
  })
  results: SurveyPairResult[];
}

/** Response shapes for `GET /surveys/mine`. */
export class PendingPairDto {
  @ApiProperty() teacherId: string;
  @ApiProperty() subjectId: string;
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
