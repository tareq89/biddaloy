import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PeriodType } from '@biddaloy/shared';

export class RecurringScheduleAudienceDto {
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsIn(['ACTIVE'])
  enrollment_status: 'ACTIVE';
}

/** `rule.kind` decides which of `day_of_month`/`weekdays` applies; the
 * service validates the combination (class-validator has no clean
 * discriminated-union support), matching how `audience` is validated. */
export class RecurringScheduleRuleDto {
  @IsIn(['MONTHLY', 'WEEKLY'])
  kind: 'MONTHLY' | 'WEEKLY';

  // MONTHLY only: 1..28, or the literal 'LAST'. `@IsOptional()` alone
  // leaves swagger's introspection with no runtime type to infer (TS
  // erases the `number | 'LAST'` union), which generated an empty
  // `Record<string, never>` schema — reject both valid shapes for a
  // typed client. `oneOf` spells out the real contract explicitly.
  @ApiPropertyOptional({
    oneOf: [
      { type: 'number', minimum: 1, maximum: 28 },
      { type: 'string', enum: ['LAST'] },
    ],
    example: 5,
  })
  @IsOptional()
  day_of_month?: number | 'LAST';

  // WEEKLY only: ISO weekdays, 1 (Monday) .. 7 (Sunday).
  @IsOptional()
  @IsArray()
  weekdays?: number[];
}

export class CreateRecurringScheduleDto {
  @IsUUID()
  academic_year_id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateNested()
  @Type(() => RecurringScheduleAudienceDto)
  audience: RecurringScheduleAudienceDto;

  @ValidateNested()
  @Type(() => RecurringScheduleRuleDto)
  rule: RecurringScheduleRuleDto;

  @IsArray()
  @IsUUID('4', { each: true })
  fee_structure_ids: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  due_days_after_period_start?: number = 9;

  @IsDateString()
  starts_on: string;

  // Defaults to the academic year's end_date, capped at it (epic #637 D4).
  @IsOptional()
  @IsDateString()
  ends_on?: string;

  @IsOptional()
  @IsBoolean()
  notify_families?: boolean = true;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}

export class UpdateRecurringScheduleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurringScheduleAudienceDto)
  audience?: RecurringScheduleAudienceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurringScheduleRuleDto)
  rule?: RecurringScheduleRuleDto;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  fee_structure_ids?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  due_days_after_period_start?: number;

  @IsOptional()
  @IsDateString()
  starts_on?: string;

  @IsOptional()
  @IsDateString()
  ends_on?: string;

  @IsOptional()
  @IsBoolean()
  notify_families?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class QueryRecurringSchedulesDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  // `@Type(() => Boolean)` is deliberately not used here: class-transformer's
  // Boolean coercion is `Boolean(value)`, which treats the *string* "false"
  // (what a query param actually is) as truthy — `?is_active=false` would
  // silently become `true`. Same fix as `fees.dto.ts`'s `include_deleted`.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_active?: boolean;
}

export class AddExclusionDto {
  @IsUUID()
  student_id: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CloneScheduleDto {
  @IsUUID()
  academic_year_id: string;
}

/** One row of a schedule's exclusions, returned only by `GET .../:id` (the
 * detail fetch) -- see `RecurringScheduleResponseDto.exclusions`. */
export class RecurringScheduleExclusionResponseDto {
  student_id: string;
  student_name: string;
  reason: string;
  created_at: Date;
}

/** One row returned by `GET/POST /fees/schedules` and `GET .../:id`. */
export class RecurringScheduleResponseDto {
  id: string;
  academic_year_id: string;
  name: string;
  audience: RecurringScheduleAudienceDto;
  rule: RecurringScheduleRuleDto;
  period_type: PeriodType;
  due_days_after_period_start: number;
  starts_on: string;
  ends_on: string;
  notify_families: boolean;
  is_active: boolean;
  last_run_period: string | null;
  fee_structure_ids: string[];
  created_at: Date;
  /** Only populated by `GET /fees/schedules/:id` (the detail fetch) and
   * `PATCH /fees/schedules/:id` -- omitted from `GET /fees/schedules`'s
   * list rows so that endpoint doesn't pay for an exclusions join per
   * schedule it never needs to render. */
  @ApiPropertyOptional({ type: () => [RecurringScheduleExclusionResponseDto] })
  exclusions?: RecurringScheduleExclusionResponseDto[];
}

/** `GET /fees/schedules/:id/preview` — who the schedule would bill today. */
export class SchedulePreviewStudentDto {
  id: string;
  full_name: string;
  registration_number: string | null;
  excluded: boolean;
}

export class SchedulePreviewDto {
  total_count: number;
  // An inline object-literal array type here makes @nestjs/swagger's CLI
  // plugin infer a self-referencing anonymous class and throw "circular
  // dependency detected" — a named class + explicit @ApiProperty avoids it.
  @ApiProperty({ type: () => [SchedulePreviewStudentDto] })
  students: SchedulePreviewStudentDto[];
}

/** `POST /fees/schedules/:id/clone` result — surfaces structures the
 * target year has no matching `(name, fee_type)` for, so staff can fix the
 * gap instead of silently losing a fee line. */
export class CloneScheduleResultDto {
  schedule: RecurringScheduleResponseDto;
  unmatched_structure_names: string[];
  /** Set when the source's class/section audience has no same-named
   * counterpart in the target year — the clone's audience is cleared to
   * `enrollment_status`-only rather than silently keeping the source
   * year's (now meaningless) class/section id. `null` when the audience
   * carried no class/section, or was matched cleanly. */
  unmatched_audience_label: string | null;
}

/** One row returned by `GET /students/:id/schedules`. */
export class StudentScheduleItemDto {
  id: string;
  name: string;
  period_type: PeriodType;
  due_days_after_period_start: number;
  is_active: boolean;
  excluded: boolean;
}
