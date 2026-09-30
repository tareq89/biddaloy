import { IsUUID, IsOptional } from 'class-validator';
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
  // [39.2.1] No `enrollment_status` on the request body: a status change is a lifecycle event
  // (POST /students/:id/leave or /readmit), not a field edit. `forbidNonWhitelisted` turns a body
  // that still sends it into a 400. `EnrollmentUpdate` below is the wider INTERNAL input.
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

/** Input type of `EnrollmentsService.update`. Wider than the request DTO so the service (and its
 * integration tests) can still exercise a status write; no HTTP caller can send one, and no
 * production flow calls `update` with it: the lifecycle service and the promotion commit write
 * status themselves. */
export type EnrollmentUpdate = UpdateEnrollmentDto & { enrollment_status?: EnrollmentStatus };
