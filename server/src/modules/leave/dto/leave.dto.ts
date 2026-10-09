import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import { LeaveType } from '@biddaloy/shared';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `GET /leave/balance` */
export class QueryLeaveBalanceDto {
  @IsUUID()
  staff_profile_id: string;
}

/** `PUT /leave/policies/:type` */
export class UpdateLeavePolicyDto {
  /** `null` = unlimited (D19). */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  annual_quota_days: number | null;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class LeaveBalanceDto {
  @ApiProperty({ enum: LeaveType }) leave_type: LeaveType;
  @ApiProperty({ nullable: true }) annual_quota_days: number | null;
  @ApiProperty() used_days: number;
  @ApiProperty({ nullable: true }) balance: number | null;
}

export class LeavePolicyDto {
  @ApiProperty({ enum: LeaveType }) leave_type: LeaveType;
  @ApiProperty({ nullable: true }) annual_quota_days: number | null;
}
