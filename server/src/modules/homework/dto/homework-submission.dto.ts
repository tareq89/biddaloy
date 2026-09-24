import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { HomeworkSubmissionStatus } from '@biddaloy/shared';

/** `POST /homework-assignments/:id/submissions` — the uploading student's
 * own id for a STUDENT caller, or the child's id for a PARENT caller.
 * `HomeworkSubmissionsService` re-validates ownership via
 * `FamilyAccessService.assertLinked` regardless of what's sent here. */
export class CreateHomeworkSubmissionDto {
  @IsUUID()
  student_id: string;
}

/** `PATCH /homework-submissions/:id` — teacher grade/override (D9). `status`
 * is the tick/partial/done outcome (`SUBMITTED`/`NOT_SUBMITTED` are
 * student-driven, never set here). `marks` is only accepted when the parent
 * `Homework.grading_mode === MARKS` (checked in the service, not here,
 * since that depends on a DB row). */
export class UpdateHomeworkSubmissionDto {
  @IsOptional()
  @IsIn([HomeworkSubmissionStatus.PARTIAL, HomeworkSubmissionStatus.DONE])
  status?: typeof HomeworkSubmissionStatus.PARTIAL | typeof HomeworkSubmissionStatus.DONE;

  @IsOptional()
  @IsInt()
  @Min(0)
  marks?: number;
}

export class HomeworkSubmissionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() assignment_id: string;
  @ApiProperty() student_id: string;
  @ApiProperty({ enum: HomeworkSubmissionStatus }) status: HomeworkSubmissionStatus;
  @ApiProperty({ nullable: true }) marks: number | null;
  @ApiProperty({ type: [Object] }) attachments: unknown[];
  @ApiProperty() created_at: Date;
  @ApiProperty() updated_at: Date;
}
