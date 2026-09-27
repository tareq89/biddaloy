import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { LeaveStatus, LeaveType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `POST /leave/requests` */
export class CreateLeaveRequestDto {
  @IsUUID()
  staff_profile_id: string;

  @IsEnum(LeaveType)
  leave_type: LeaveType;

  // `strict: true` rejects a calendar-invalid date like `2026-02-31` (plain
  // `@Matches(/^\d{4}-\d{2}-\d{2}$/)` only checks the shape, not validity).
  @IsDateString({ strict: true }, { message: 'start_date must be a valid YYYY-MM-DD date' })
  start_date: string;

  @IsDateString({ strict: true }, { message: 'end_date must be a valid YYYY-MM-DD date' })
  end_date: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;
}

/** `POST /leave/requests/:id/decide` */
export class DecideLeaveRequestDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;
}

/** `GET /leave/balance` */
export class QueryLeaveBalanceDto {
  @IsUUID()
  staff_profile_id: string;
}

/** `PUT /leave/policies/:type` */
export class UpdateLeavePolicyDto {
  @IsInt()
  @Min(0)
  annual_quota_days: number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class LeaveRecordDto {
  @ApiProperty() id: string;
  @ApiProperty() staff_profile_id: string;
  @ApiProperty({ enum: LeaveType }) leave_type: LeaveType;
  @ApiProperty() start_date: string;
  @ApiProperty() end_date: string;
  @ApiProperty() days: number;
  @ApiProperty({ enum: LeaveStatus }) status: LeaveStatus;
  @ApiProperty({ nullable: true }) reason: string | null;
  @ApiProperty({ nullable: true }) approved_by: string | null;
  @ApiProperty({ nullable: true }) decided_at: Date | null;
}

export class LeaveBalanceDto {
  @ApiProperty({ enum: LeaveType }) leave_type: LeaveType;
  @ApiProperty() annual_quota_days: number;
  @ApiProperty() used_days: number;
  @ApiProperty() balance: number;
}

export class LeavePolicyDto {
  @ApiProperty({ enum: LeaveType }) leave_type: LeaveType;
  @ApiProperty() annual_quota_days: number;
}
