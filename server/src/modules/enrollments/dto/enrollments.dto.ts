import { IsUUID, IsOptional, IsEnum } from 'class-validator';
import { EnrollmentStatus } from '@beton-boi/shared';

export class CreateEnrollmentDto {
  @IsUUID()
  student_id: string;

  @IsUUID()
  class_id: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsUUID()
  academic_year_id: string;
}

export class UpdateEnrollmentDto {
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  @IsOptional()
  @IsUUID()
  section_id?: string;
}