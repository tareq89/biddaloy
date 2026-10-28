import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HomeworkSubmissionStatus } from '@biddaloy/shared';

/** Marks ceiling for one homework (integer). Matches the exam full-marks ceiling. */
export const HOMEWORK_MARKS_MAX = 9999;

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
  @Max(HOMEWORK_MARKS_MAX)
  marks?: number;
}

/** One student in `PATCH /homework-assignments/:id/submissions` (#2899). `NOT_SUBMITTED` clears
 * the teacher's mark (the service turns it into SUBMITTED when files exist, D8). `marks: null`
 * clears marks. `ValidateIf`, not `IsOptional`, so a `null` status is a 400. */
export class GradeSubmissionItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  student_id: string;

  @ApiProperty({
    required: false,
    enum: [
      HomeworkSubmissionStatus.NOT_SUBMITTED,
      HomeworkSubmissionStatus.PARTIAL,
      HomeworkSubmissionStatus.DONE,
    ],
  })
  @ValidateIf((o: GradeSubmissionItemDto) => o.status !== undefined)
  @IsIn([
    HomeworkSubmissionStatus.NOT_SUBMITTED,
    HomeworkSubmissionStatus.PARTIAL,
    HomeworkSubmissionStatus.DONE,
  ])
  status?:
    | typeof HomeworkSubmissionStatus.NOT_SUBMITTED
    | typeof HomeworkSubmissionStatus.PARTIAL
    | typeof HomeworkSubmissionStatus.DONE;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: HOMEWORK_MARKS_MAX })
  @ValidateIf((o: GradeSubmissionItemDto) => o.marks !== undefined && o.marks !== null)
  @IsInt()
  @Min(0)
  @Max(HOMEWORK_MARKS_MAX)
  marks?: number | null;
}

export class GradeSubmissionsDto {
  @ApiProperty({ type: [GradeSubmissionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => GradeSubmissionItemDto)
  items: GradeSubmissionItemDto[];
}

/** `GET /homework-assignments/:id/submissions` row: one per student on the list (D5). */
export class HomeworkSubmissionRosterRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() student_name: string;
  @ApiProperty() roll_number: number;
  @ApiProperty({ nullable: true }) submission_id: string | null;
  @ApiProperty({ enum: HomeworkSubmissionStatus }) status: HomeworkSubmissionStatus;
  @ApiProperty({ nullable: true }) marks: number | null;
  @ApiProperty() attachment_count: number;
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
