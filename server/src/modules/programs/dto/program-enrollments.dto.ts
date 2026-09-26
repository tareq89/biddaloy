import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProgramEnrollmentStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** [34.2.1] Bulk-enrol up to 500 students into a program in one call. */
export class EnrolStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  student_ids: string[];

  @IsOptional()
  @IsDateString()
  started_on?: string;
}

export class UpdateEnrollmentDto {
  @IsEnum(ProgramEnrollmentStatus)
  status: ProgramEnrollmentStatus;

  @IsOptional()
  @IsDateString()
  ended_on?: string;
}

/** [D5, D21] Bulk-record one milestone's achievement across up to 500
 * enrolments in one call — the service turns this into a single
 * `INSERT ... ON CONFLICT DO UPDATE`, not a loop. */
export class RecordAchievementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  enrollment_ids: string[];

  @IsUUID('4')
  milestone_id: string;

  @IsOptional()
  @IsDateString()
  achieved_on?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999.99)
  score?: number;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(50)
  grade?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  @MaxLength(500)
  remark?: string;
}

export class ListEnrollmentsQuery {
  @IsOptional()
  @IsEnum(ProgramEnrollmentStatus)
  status?: ProgramEnrollmentStatus;
}
