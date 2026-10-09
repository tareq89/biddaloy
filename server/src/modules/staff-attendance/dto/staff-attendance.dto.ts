import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
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
  date: string;

  /** Required when correcting an already-marked day outside the tenant's
   * correction window. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntryDto)
  entries: StaffAttendanceEntryDto[];
}

/** Query params for `GET /staff-attendance/summary`. */
export class QueryStaffAttendanceSummaryDto {
  @IsUUID()
  staff_profile_id: string;

  @IsString()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @IsString()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
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
