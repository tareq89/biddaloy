import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

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
