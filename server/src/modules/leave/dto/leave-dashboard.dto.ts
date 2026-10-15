import { ApiProperty } from '@nestjs/swagger';
import { LeaveBalanceDto } from './leave.dto';

/** [8.10.7.3.05] "My leave balance" widget. Unlimited (null-quota) types add nothing to the quota/balance totals. */
export class MyLeaveBalanceDto {
  @ApiProperty() has_profile: boolean;
  @ApiProperty() year: number;
  @ApiProperty() total_quota_days: number;
  @ApiProperty() total_used_days: number;
  @ApiProperty() total_balance_days: number;
  @ApiProperty({ type: [LeaveBalanceDto] }) by_type: LeaveBalanceDto[];
}
