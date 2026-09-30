import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StudentLifecycleEventType } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { todayInSchoolTz } from '../../../common/time';

/** `YYYY-MM-DD` strings compare correctly as plain strings. */
function IsNotFutureDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotFutureDate',
      validator: {
        validate: (v: unknown) => typeof v === 'string' && v <= todayInSchoolTz(),
        defaultMessage: () => 'occurred_on cannot be in the future',
      },
    },
    options,
  );
}

export type LeaveEventType = Exclude<StudentLifecycleEventType, 'READMITTED'>;

export class LeaveStudentDto {
  @ApiProperty({ enum: ['WITHDRAWN', 'TRANSFERRED_OUT', 'GRADUATED'] })
  @IsIn(['WITHDRAWN', 'TRANSFERRED_OUT', 'GRADUATED'])
  type: LeaveEventType;

  @ApiProperty({ example: '2026-09-30', description: 'Date only (YYYY-MM-DD), not in the future' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsNotFutureDate()
  occurred_on: string;

  @ApiProperty({ maxLength: 1000 })
  @SanitizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @SanitizeText()
  @IsString()
  @MaxLength(500)
  destination?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @SanitizeText()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class ReadmitStudentDto {
  @ApiProperty({ example: '2026-09-30', description: 'Date only (YYYY-MM-DD), not in the future' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsNotFutureDate()
  occurred_on: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  class_section_id: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @SanitizeText()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @SanitizeText()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class StudentLifecycleEventDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tenant_id: string;
  @ApiProperty({ format: 'uuid' }) student_id: string;
  @ApiProperty({ format: 'uuid' }) enrollment_id: string;
  @ApiProperty({ format: 'uuid' }) academic_year_id: string;
  @ApiProperty({ enum: Object.values(StudentLifecycleEventType) })
  event_type: StudentLifecycleEventType;
  @ApiProperty({ example: '2026-09-30' }) occurred_on: string;
  @ApiProperty() reason: string;
  @ApiProperty({ nullable: true, type: String }) destination: string | null;
  @ApiProperty({ nullable: true, type: String }) remark: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  recorded_by_user_id: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
}
