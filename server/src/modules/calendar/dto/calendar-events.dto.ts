import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `POST /calendar/events`. Academic year is derived server-side from
 * `start_date`, never taken from the caller (see `CalendarEventsService`). */
export class CreateCalendarEventDto {
  @IsEnum(CalendarEventType)
  type: CalendarEventType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @SanitizeText()
  name: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  description?: string;

  @IsDateString()
  start_date: string;

  @IsDateString()
  end_date: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_ONLY, { message: 'start_time must be HH:mm' })
  start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_ONLY, { message: 'end_time must be HH:mm' })
  end_time?: string;

  @IsOptional()
  @IsBoolean()
  counts_as_working_day?: boolean;

  @IsOptional()
  @IsEnum(CalendarAudience)
  audience?: CalendarAudience;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  class_ids?: string[];

  /** Defaults to `true` — a caller must explicitly opt into leaving an
   * event as a draft (D9: drafts are invisible, don't count toward
   * working-day math, and are never notified/exported). */
  @IsOptional()
  @IsBoolean()
  publish?: boolean = true;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_sms?: boolean;
}

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsEnum(CalendarEventType)
  type?: CalendarEventType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @SanitizeText()
  name?: string;

  // `null` is a deliberate "clear this field"; `undefined` (the key
  // absent) leaves the existing value untouched — see the service's
  // `update()`.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @SanitizeText()
  description?: string | null;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(TIME_ONLY, { message: 'start_time must be HH:mm' })
  start_time?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(TIME_ONLY, { message: 'end_time must be HH:mm' })
  end_time?: string | null;

  @IsOptional()
  @IsBoolean()
  counts_as_working_day?: boolean;

  @IsOptional()
  @IsEnum(CalendarAudience)
  audience?: CalendarAudience;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  class_ids?: string[];

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_sms?: boolean;
}

/** `GET /calendar/events` — list query, paginated. Range is bounded to the
 * same 400-day ceiling as `SchoolCalendarService.getWorkingDays`. */
export class QueryCalendarEventsDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be a valid YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be a valid YYYY-MM-DD date' })
  to?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @IsEnum(CalendarEventType, { each: true })
  types?: CalendarEventType[];

  @IsOptional()
  @IsEnum(CalendarAudience)
  audience?: CalendarAudience;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  /** Staff-only escape hatch to see unpublished drafts. Ignored for
   * PARENT/STUDENT/TEACHER viewers — the service never trusts this flag
   * for a non-`CALENDAR_MANAGE` role. */
  // `@Type(() => Boolean)` deliberately not used here: class-transformer's
  // Boolean coercion is `Boolean(value)`, which treats the *string*
  // `"false"` (what a query param actually is) as truthy — this transform
  // parses the two literal strings a query param can actually carry.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  include_drafts?: boolean;

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

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class CalendarEventResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() academic_year_id: string;
  @ApiProperty() type: CalendarEventType;
  @ApiProperty() name: string;
  @ApiProperty({ required: false, nullable: true }) description: string | null;
  @ApiProperty() start_date: string;
  @ApiProperty() end_date: string;
  @ApiProperty({ required: false, nullable: true }) start_time: string | null;
  @ApiProperty({ required: false, nullable: true }) end_time: string | null;
  @ApiProperty() counts_as_working_day: boolean;
  @ApiProperty() audience: CalendarAudience;
  @ApiProperty({ type: String, isArray: true }) class_ids: string[];
  /** `true` once past-lock would refuse a further edit (D6) — i.e. the
   * event's `end_date` is strictly before the tenant's local "today". */
  @ApiProperty() is_locked: boolean;
  @ApiProperty() published: boolean;
}

export class CalendarEventListResponseDto {
  @ApiProperty({ type: CalendarEventResponseDto, isArray: true }) data: CalendarEventResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
