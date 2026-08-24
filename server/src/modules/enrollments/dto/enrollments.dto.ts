import { IsUUID, IsOptional, IsEnum } from 'class-validator';
import { EnrollmentStatus } from '@biddaloy/shared';

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

  // [8.11.3] Lets a PATCH move a student to a different class, not just a
  // different section within the same class or a status-only change —
  // previously nothing on this DTO could change which class an enrollment
  // pointed at.
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;
}
