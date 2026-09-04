import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `GET /school-calendar/holidays` — list query, paginated. */
export class QueryHolidayDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

/** `POST /school-calendar/holidays`. `start_date`/`end_date` are inclusive —
 * a one-day holiday sets both the same. */
export class CreateHolidayDto {
  @IsUUID()
  academic_year_id: string;

  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @SanitizeText()
  name: string;

  /** True for a calendar entry (exam day, school event) that is on the
   * calendar but must still count toward the working-day denominator.
   * Defaults to `false` — a plain holiday removes the day. */
  @IsOptional()
  @IsBoolean()
  counts_as_working_day?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsBoolean()
  counts_as_working_day?: boolean;
}

/** `GET /school-calendar/working-days` — bounded to 400 days, see
 * `SchoolCalendarService.getWorkingDays`. */
export class QueryWorkingDaysDto {
  @IsString()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @IsString()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @IsOptional()
  @IsUUID()
  academic_year_id?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class HolidayResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() academic_year_id: string;
  @ApiProperty() start_date: string;
  @ApiProperty() end_date: string;
  @ApiProperty() name: string;
  @ApiProperty() counts_as_working_day: boolean;
}

export class HolidayListResponseDto {
  @ApiProperty({ type: HolidayResponseDto, isArray: true }) data: HolidayResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class WorkingDaysResponseDto {
  @ApiProperty({ type: String, isArray: true }) dates: string[];
  @ApiProperty() count: number;
}
