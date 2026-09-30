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

/** Internal input to `EnrollmentsService.update`. Wider than the request DTO: server-side flows
 * (promotions, tests) may still set a status; an HTTP caller cannot. */
export type EnrollmentUpdate = UpdateEnrollmentDto & { enrollment_status?: EnrollmentStatus };
