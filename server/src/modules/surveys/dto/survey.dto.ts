import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export const SURVEY_RESPONDENTS = ['STUDENTS', 'GUARDIANS', 'BOTH'] as const;

export class SurveyQuestionInputDto {
  @IsString()
  @MaxLength(1000)
  @SanitizeText()
  @IsNotEmpty()
  text: string;

  @IsBoolean()
  starsEnabled: boolean;
}

export class SurveyTargetInputDto {
  @IsUUID()
  teacherId: string;

  @IsUUID()
  subjectId: string;
}

/** `POST /surveys` — create a DRAFT survey with its questions and targets. */
export class CreateSurveyDto {
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  @IsNotEmpty()
  title: string;

  @IsBoolean()
  anonymous: boolean;

  @IsIn(SURVEY_RESPONDENTS)
  respondent: (typeof SURVEY_RESPONDENTS)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions: SurveyQuestionInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SurveyTargetInputDto)
  targets: SurveyTargetInputDto[];

  @IsOptional()
  @IsDateString()
  opensAt?: string;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  minResponses?: number;
}

/** `PATCH /surveys/:id` — DRAFT only. Questions/targets, when sent, replace the whole list. */
export class UpdateSurveyDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @IsIn(SURVEY_RESPONDENTS)
  respondent?: (typeof SURVEY_RESPONDENTS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions?: SurveyQuestionInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SurveyTargetInputDto)
  targets?: SurveyTargetInputDto[];

  @IsOptional()
  @IsDateString()
  opensAt?: string;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  minResponses?: number;
}

/** Response shapes for the admin survey endpoints (the entity columns, as sent on the wire). */
export class SurveyQuestionDto {
  @ApiProperty() id: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty() survey_id: string;
  @ApiProperty() sort_order: number;
  @ApiProperty() text: string;
  @ApiProperty() stars_enabled: boolean;
}

export class SurveyTargetDto {
  @ApiProperty() id: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty() survey_id: string;
  @ApiProperty() teacher_id: string;
  @ApiProperty() subject_id: string;
}

export class SurveyDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['DRAFT', 'OPEN', 'CLOSED'] }) status: string;
  @ApiProperty() anonymous: boolean;
  @ApiProperty({ enum: SURVEY_RESPONDENTS }) respondent: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) opens_at: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closes_at: Date | null;
  @ApiProperty() min_responses: number;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
  @ApiProperty({ type: [SurveyQuestionDto] }) questions: SurveyQuestionDto[];
  @ApiProperty({ type: [SurveyTargetDto] }) targets: SurveyTargetDto[];
}
