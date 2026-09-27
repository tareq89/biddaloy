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
import { ApiProperty } from '@nestjs/swagger';
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

export class UpdateProgramEnrollmentDto {
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

export class EnrollmentStudentSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ nullable: true }) roll_number: string | number | null;
  @ApiProperty({ nullable: true }) class_name: string | null;
  @ApiProperty({ nullable: true }) section_name: string | null;
}

export class EnrollmentListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ProgramEnrollmentStatus }) status: ProgramEnrollmentStatus;
  @ApiProperty() started_on: string;
  @ApiProperty({ nullable: true }) ended_on: string | null;
  @ApiProperty({ type: EnrollmentStudentSummaryDto }) student: EnrollmentStudentSummaryDto;
  @ApiProperty() achieved_count: number;
  @ApiProperty() milestone_total: number;
}

export class EnrolStudentsResultDto {
  @ApiProperty() created: number;
  @ApiProperty() skipped: number;
}

export class RecordAchievementsResultDto {
  @ApiProperty() upserted: number;
}

export class UpdateProgramEnrollmentResultDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ProgramEnrollmentStatus }) status: ProgramEnrollmentStatus;
  @ApiProperty() started_on: string;
  @ApiProperty({ nullable: true }) ended_on: string | null;
}

export class DeletedResultDto {
  @ApiProperty({ enum: [true] }) deleted: true;
}

export class StudentProgramMilestoneAchievementDto {
  @ApiProperty() id: string;
  @ApiProperty() achieved_on: string;
  @ApiProperty({ nullable: true }) score: string | null;
  @ApiProperty({ nullable: true }) grade: string | null;
  @ApiProperty({ nullable: true }) remark: string | null;
}

export class StudentProgramMilestoneDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() sequence: number;
  @ApiProperty({ type: StudentProgramMilestoneAchievementDto, nullable: true })
  achievement: StudentProgramMilestoneAchievementDto | null;
}

export class StudentProgramInfoDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() is_active: boolean;
  @ApiProperty() show_on_report_card: boolean;
}

export class StudentProgramEnrollmentInfoDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ProgramEnrollmentStatus }) status: ProgramEnrollmentStatus;
  @ApiProperty() started_on: string;
  @ApiProperty({ nullable: true }) ended_on: string | null;
}

export class StudentProgramEntryDto {
  @ApiProperty({ type: StudentProgramInfoDto }) program: StudentProgramInfoDto;
  @ApiProperty({ type: StudentProgramEnrollmentInfoDto })
  enrollment: StudentProgramEnrollmentInfoDto;
  @ApiProperty({ type: StudentProgramMilestoneDto, isArray: true })
  milestones: StudentProgramMilestoneDto[];
  @ApiProperty() achieved_count: number;
  @ApiProperty() milestone_total: number;
}
