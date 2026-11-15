import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_RESULT_ROWS = 200;
export const CUTOFF_MODES = ['TOP_N', 'MIN_SCORE'] as const;
export type CutoffMode = (typeof CUTOFF_MODES)[number];

export class StageResultRowDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  applicant_id: string;

  @ApiProperty({ description: 'false = absent: no score, no passed.' })
  @IsBoolean()
  attended: boolean;

  @ApiPropertyOptional({ example: 72.5, description: 'Score stages only; 2 decimals.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999)
  score?: number;

  @ApiPropertyOptional({ description: 'Pass/fail stages only.' })
  @IsOptional()
  @IsBoolean()
  passed?: boolean;
}

export class PutStageResultsDto {
  @ApiProperty({ type: [StageResultRowDto], maxItems: MAX_RESULT_ROWS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RESULT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => StageResultRowDto)
  results: StageResultRowDto[];
}

export class PutStageResultsResponseDto {
  @ApiProperty() saved: number;
}

export class CutoffPreviewDto {
  @ApiProperty({ enum: CUTOFF_MODES, enumName: 'AdmissionCutoffMode' })
  @IsIn(CUTOFF_MODES)
  mode: CutoffMode;

  @ApiProperty({ example: 30, description: 'TOP_N: a whole number; MIN_SCORE: 2 decimals.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999)
  value: number;
}

export class CutoffCommitDto extends CutoffPreviewDto {
  @ApiPropertyOptional({ type: [String], maxItems: MAX_RESULT_ROWS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RESULT_ROWS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  add?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: MAX_RESULT_ROWS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RESULT_ROWS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  remove?: string[];
}

export class CutoffPreviewResponseDto {
  @ApiProperty({ type: [String] }) passing: string[];
  @ApiProperty({ type: [String] }) failing: string[];
  @ApiProperty() passing_count: number;
  @ApiProperty() failing_count: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Lowest passing score.' })
  boundary_score: number | null;
  @ApiProperty({ description: 'Applicants on the boundary score, split by the tie-break.' })
  tied_at_boundary: number;
}

export class CutoffCommitResponseDto {
  @ApiProperty() passed: number;
  @ApiProperty() failed: number;
}
