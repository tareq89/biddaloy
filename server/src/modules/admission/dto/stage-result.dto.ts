import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

/** [71.4.00a] Who is on a cut-off side: enough to draw the row without a second fetch. */
export class CutoffRowDto {
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) roll: string | null;
}

export class CutoffPreviewResponseDto {
  @ApiProperty({ type: [String] }) passing: string[];
  @ApiProperty({ type: [String] }) failing: string[];
  @ApiProperty({ type: [CutoffRowDto] }) passing_rows: CutoffRowDto[];
  @ApiProperty({ type: [CutoffRowDto] }) failing_rows: CutoffRowDto[];
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
  @ApiProperty({ type: [CutoffRowDto] }) passing_rows: CutoffRowDto[];
  @ApiProperty({ type: [CutoffRowDto] }) failing_rows: CutoffRowDto[];
  @ApiProperty({ type: String, format: 'date-time' }) cutoff_committed_at: string;
}

/** [71.4.00a] `GET /admission/stages/:id/results`. */
export class ListStageResultsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class StageResultListRowDto {
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty({ type: String, nullable: true }) roll: string | null;
  @ApiProperty() name: string;
  @ApiProperty() attended: boolean;
  @ApiProperty({ type: Number, nullable: true }) score: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) passed: boolean | null;
}

export class StageResultListResponseDto {
  @ApiProperty({ type: [StageResultListRowDto] }) data: StageResultListRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
