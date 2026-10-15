import { ApiProperty } from '@nestjs/swagger';
import { LeaveType } from '@biddaloy/shared';

export class StaffOnLeaveDto {
  @ApiProperty({ format: 'uuid' }) staff_profile_id!: string;
  @ApiProperty({ example: 'Rasheda Parvin' }) full_name!: string;
  @ApiProperty({ enum: LeaveType, enumName: 'LeaveType' }) leave_type!: LeaveType;
  @ApiProperty({ example: '2026-10-09' }) end_date!: string;
}

export class StaffTodayWidgetDto {
  @ApiProperty({ example: '2026-10-07' }) date!: string;
  @ApiProperty() staff_total!: number;
  @ApiProperty() present!: number;
  @ApiProperty() late!: number;
  @ApiProperty() absent!: number;
  @ApiProperty({ description: 'Staff on approved leave today (length of on_leave)' })
  leave!: number;
  @ApiProperty({ description: 'Active staff with no mark today' }) unmarked!: number;
  @ApiProperty({ description: 'Marked ABSENT today with no approved leave covering today' })
  absent_without_leave!: number;
  @ApiProperty({ type: [StaffOnLeaveDto] }) on_leave!: StaffOnLeaveDto[];
}
