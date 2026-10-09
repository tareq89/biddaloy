import { IsDateString, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LeaveType } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** STAFF_LEAVE payload. */
export class StaffLeavePayloadDto {
  @IsEnum(LeaveType)
  leave_type: LeaveType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'start_date must be a valid YYYY-MM-DD date' })
  @IsDateString({ strict: true }, { message: 'start_date must be a valid YYYY-MM-DD date' })
  start_date: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end_date must be a valid YYYY-MM-DD date' })
  @IsDateString({ strict: true }, { message: 'end_date must be a valid YYYY-MM-DD date' })
  end_date: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  reason: string;
}
