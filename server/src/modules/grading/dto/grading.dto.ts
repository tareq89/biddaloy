import {
  IsUUID,
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { GradingScale } from '../entities/grading-scale.entity';
import { GradingBand } from '../entities/grading-band.entity';

export class CreateGradingScaleDto {
  @IsUUID()
  academic_year_id: string;

  /** null/omitted = this year's default scale (D1). */
  @IsOptional()
  @IsUUID()
  class_id?: string | null;

  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}

export class UpdateGradingScaleDto {
  @IsOptional()
  @SanitizeText()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}

export class BandInputDto {
  @IsInt()
  @Min(0)
  @Max(100)
  percent_from: number;

  @IsInt()
  @Min(0)
  @Max(100)
  percent_to: number;

  @SanitizeText()
  @MinLength(1)
  @MaxLength(10)
  grade: string;

  // `numeric(4,2)` on `grading_bands.gpa` (2 integer digits, 2 decimal) —
  // bounds match the column, not just the "0-5 is typical" convention, so
  // an out-of-range value never reaches Postgres as a raw column error.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  gpa?: number | null;

  @IsOptional()
  @IsBoolean()
  is_fail?: boolean;

  @IsInt()
  sequence: number;

  @IsOptional()
  @SanitizeText()
  @MaxLength(500)
  comment?: string | null;
}

/** Body for both the recompute preview and confirm endpoints — the whole
 * proposed band set (D-decision: writes replace the set, never patch a
 * single row). */
export class RecomputeBandsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BandInputDto)
  bands: BandInputDto[];
}

export class CopyScaleDto {
  /** The scale bands are copied FROM. :id in the route is the target. */
  @IsUUID()
  source_scale_id: string;
}

export class GradingBandDto {
  id: string;
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa: number | null;
  is_fail: boolean;
  sequence: number;
  comment: string | null;
}

export class GradingScaleDto {
  id: string;
  academic_year_id: string;
  class_id: string | null;
  name: string;
  revision: number;
  bands: GradingBandDto[];
}

export function toGradingBandDto(band: GradingBand): GradingBandDto {
  return {
    id: band.id,
    percent_from: band.percent_from,
    percent_to: band.percent_to,
    grade: band.grade,
    gpa: band.gpa === null ? null : Number(band.gpa),
    is_fail: band.is_fail,
    sequence: band.sequence,
    comment: band.comment,
  };
}

export function toGradingScaleDto(scale: GradingScale, bands: GradingBand[]): GradingScaleDto {
  return {
    id: scale.id,
    academic_year_id: scale.academic_year_id,
    class_id: scale.class_id,
    name: scale.name,
    revision: scale.revision,
    bands: bands.map(toGradingBandDto),
  };
}

export interface RecomputePreviewResult {
  valid: boolean;
  problems: { type: string; message: string; index?: number }[];
  /** Would this write actually change anything — a no-op preview (bands
   * submitted identical to what's stored) still needs no approval. */
  bands_changed: boolean;
  affected_result_count: number;
}
