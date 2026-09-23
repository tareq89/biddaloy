import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsNotEmpty,
  Matches,
  IsEnum,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PeriodSlotKind } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** Postgres `time` columns come back as `'HH:mm:ss'`; accept `HH:mm` too
 * since that is what a client `<input type="time">` sends. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateShiftDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name: string;

  @Matches(TIME_RE, { message: 'day_starts_at must be HH:mm' })
  day_starts_at: string;

  @Matches(TIME_RE, { message: 'day_ends_at must be HH:mm' })
  day_ends_at: string;

  @IsInt()
  @Min(0)
  sequence: number;
}

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'day_starts_at must be HH:mm' })
  day_starts_at?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'day_ends_at must be HH:mm' })
  day_ends_at?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;
}

export class QueryShiftDto {
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

export class CreateRoomDto {
  // Nullable — a small school with one building never names it (see
  // `Room` entity docstring on the `NULLS NOT DISTINCT` uniqueness).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  building?: string | null;

  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  room_no: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  building?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  room_no?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;
}

export class QueryRoomDto {
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

/** One row of a shift's period-slot grid, as submitted by
 * `PUT .../period-slots` — the whole set is replaced in one transaction
 * (see `PeriodSlotsService.replaceForShift`), not edited row by row. */
export class PeriodSlotItemDto {
  @IsInt()
  @Min(0)
  sequence: number;

  @IsEnum(PeriodSlotKind)
  kind: PeriodSlotKind;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name?: string | null;

  @Matches(TIME_RE, { message: 'starts_at must be HH:mm' })
  starts_at: string;

  @Matches(TIME_RE, { message: 'ends_at must be HH:mm' })
  ends_at: string;
}

export class ReplacePeriodSlotsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PeriodSlotItemDto)
  slots: PeriodSlotItemDto[];
}

/** D7 — changeover-suggestion query: client proposes a period count and
 * duration, server offers `starts_at`/`ends_at` per period using the
 * tenant's `TenantSettings.routine.defaultChangeoverMinutes`. Admin may
 * overwrite any of the suggested times; the server never rewrites a time
 * the admin actually set (see `ReplacePeriodSlotsDto` above, which takes
 * the final times verbatim). */
export class ChangeoverSuggestionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  periodCount: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  periodDurationMinutes: number;
}
