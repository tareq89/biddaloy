import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';

/** `GET /applications/reports`: every filter optional; `from`/`to` are `YYYY-MM-DD`. */
export class ReportsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class PendingTypeCountDto {
  @ApiProperty({ enum: ApplicationType, enumName: 'ApplicationType' })
  type: ApplicationType;

  @ApiProperty()
  count: number;
}

/** `GET /applications/pending-count`: exactly what `view=inbox` lists. */
export class PendingCountDto {
  @ApiProperty()
  total: number;

  @ApiProperty({ type: [PendingTypeCountDto] })
  by_type: PendingTypeCountDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  oldest_pending_at: string | null;
}

export class ReportTypeStatusRowDto {
  @ApiProperty({ enum: ApplicationType, enumName: 'ApplicationType' })
  type: ApplicationType;

  @ApiProperty({ enum: ApplicationStatus, enumName: 'ApplicationStatus' })
  status: ApplicationStatus;

  @ApiProperty()
  count: number;
}

export class ReportMonthRowDto {
  @ApiProperty({ example: '2026-09' })
  month: string;

  @ApiProperty()
  submitted: number;

  @ApiProperty()
  approved: number;

  @ApiProperty()
  rejected: number;
}

export class StalePendingRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026/0045' })
  serial: string;

  @ApiProperty({ enum: ApplicationType, enumName: 'ApplicationType' })
  type: ApplicationType;

  @ApiProperty({ type: String, nullable: true })
  applicant_name: string | null;

  @ApiProperty()
  current_step: number;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: string;
}

export class OnLeaveStaffRowDto {
  @ApiProperty({ format: 'uuid' })
  staff_profile_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  leave_type: string;

  @ApiProperty({ example: '2026-10-10' })
  end_date: string;
}

export class OnLeaveStudentRowDto {
  @ApiProperty({ format: 'uuid' })
  student_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  class_name: string;

  @ApiProperty()
  section_name: string;

  @ApiProperty({ example: '2026-10-09' })
  end_date: string;
}

export class OnLeaveTodayDto {
  @ApiProperty({ type: [OnLeaveStaffRowDto] })
  staff: OnLeaveStaffRowDto[];

  @ApiProperty({ type: [OnLeaveStudentRowDto] })
  students: OnLeaveStudentRowDto[];
}

export class StaffLeaveDaysRowDto {
  @ApiProperty({ format: 'uuid' })
  staff_profile_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, example: { SICK: 3 } })
  by_type: Record<string, number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { '2026-10': 3 },
  })
  by_month: Record<string, number>;
}

export class ApplicationReportsDto {
  @ApiProperty({ type: [ReportTypeStatusRowDto] })
  by_type_status: ReportTypeStatusRowDto[];

  @ApiProperty({ type: [ReportMonthRowDto] })
  by_month: ReportMonthRowDto[];

  @ApiProperty({ type: Number, nullable: true })
  avg_decision_hours: number | null;

  @ApiProperty({ type: [StalePendingRowDto] })
  stale_pending: StalePendingRowDto[];

  @ApiProperty({ type: OnLeaveTodayDto })
  on_leave_today: OnLeaveTodayDto;

  @ApiProperty({ type: [StaffLeaveDaysRowDto] })
  staff_leave_days: StaffLeaveDaysRowDto[];
}
