import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** One staff member's mark within a `PUT .../register` payload. */
export class StaffAttendanceEntryDto {
  @IsUUID()
  staff_profile_id: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;
}

/** `PUT /staff-attendance/register` — the whole day's staff marks in one
 * call. Plain upsert, no `base_version`/`client_request_id` — staff
 * attendance is admin/self-marked, not offline-queued like the classroom
 * register. */
export class PutStaffAttendanceRegisterDto {
  @IsString()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a real calendar date' })
  date: string;

  /** Required when correcting an already-marked day outside the tenant's
   * correction window. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;

  /** Marks a non-working day (holiday or weekly off) as intentional. Only
   * effective for an admin-level caller (`LEAVE_APPROVE`). */
  @IsOptional()
  @IsBoolean()
  force_non_working_day?: boolean;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntryDto)
  entries: StaffAttendanceEntryDto[];
}

/** Query params for `GET /staff-attendance/register`. */
export class QueryStaffAttendanceRegisterDto {
  @IsString()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a real calendar date' })
  date: string;
}

/** Query params for `GET /staff-attendance/summary`. */
export class QueryStaffAttendanceSummaryDto {
  @IsUUID()
  staff_profile_id: string;

  @IsString()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'from must be a real calendar date' })
  from: string;

  @IsString()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'to must be a real calendar date' })
  to: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class StaffAttendanceRecordDto {
  @ApiProperty() staff_profile_id: string;
  @ApiProperty() record_id: string;
  @ApiProperty({ enum: AttendanceStatus }) status: AttendanceStatus;
}

export class StaffAttendanceRegisterResponseDto {
  @ApiProperty() date: string;
  @ApiProperty() session_id: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: StaffAttendanceRecordDto, isArray: true })
  records: StaffAttendanceRecordDto[];
}

/** `GET /staff-attendance/summary` — same frozen shape as
 * `AttendanceSummary`, minus `marked_days`/`unmarked_days`/`policy`, which
 * this ticket's contract doesn't need. */
export class StaffAttendanceSummaryDto {
  @ApiProperty() working_days: number;
  @ApiProperty() present_days: number;
  @ApiProperty() late_days: number;
  @ApiProperty() absent_days: number;
  @ApiProperty() leave_days: number;
  @ApiProperty({ type: Number, nullable: true }) attendance_percentage: number | null;
}

/** One staff member the caller may mark on the requested day. */
export class StaffAttendanceRosterRowDto {
  @ApiProperty() staff_profile_id: string;
  @ApiProperty() user_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() role: string;
  @ApiProperty({ enum: AttendanceStatus, nullable: true })
  status: AttendanceStatus | null;
}

/** `GET /staff-attendance/register` — the day's roster with saved marks. */
export class StaffAttendanceDayDto {
  @ApiProperty() date: string;
  @ApiProperty({ description: 'True when saving a correction needs a `reason`.' })
  reason_required: boolean;
  @ApiProperty() non_working_day: boolean;
  @ApiProperty({ type: StaffAttendanceRosterRowDto, isArray: true })
  staff: StaffAttendanceRosterRowDto[];
}
