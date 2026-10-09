import { IsDateString, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { StudentLeaveReason } from '@biddaloy/shared';
import { SanitizeText } from '../../../../common/decorators/sanitize-text.decorator';

/** STUDENT_LEAVE payload (D30). */
export class StudentLeavePayloadDto {
  @IsEnum(StudentLeaveReason)
  reason_kind: StudentLeaveReason;

  @IsDateString({ strict: true }, { message: 'start_date must be a valid YYYY-MM-DD date' })
  start_date: string;

  @IsDateString({ strict: true }, { message: 'end_date must be a valid YYYY-MM-DD date' })
  end_date: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  @SanitizeText()
  details: string;
}
