import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { HomeworkAssignmentStatus, HomeworkGradingMode } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `POST /homework` — create one Homework. Attachments are uploaded through
 * the shared upload endpoint (22.3.2) and referenced here by key/url, not
 * inline binary. */
export class CreateHomeworkDto {
  @IsUUID()
  subject_id: string;

  @IsUUID()
  class_id: string;

  @IsString()
  @MaxLength(200)
  @SanitizeText()
  title: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  description?: string;

  @IsEnum(HomeworkGradingMode)
  grading_mode: HomeworkGradingMode;

  @IsOptional()
  @IsArray()
  attachments?: unknown[];
}

/** `GET /homework` filters. */
export class QueryHomeworkDto {
  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsUUID()
  subject_id?: string;

  @IsOptional()
  @IsEnum(HomeworkAssignmentStatus)
  status?: HomeworkAssignmentStatus;
}

/** `POST /homework/:id/assign` — target is exactly one of section or
 * student (D24), same rule the DB CHECK constraint enforces. */
export class AssignHomeworkDto {
  @ValidateIf((o: AssignHomeworkDto) => !o.student_id)
  @IsUUID()
  section_id?: string;

  @ValidateIf((o: AssignHomeworkDto) => !o.section_id)
  @IsUUID()
  student_id?: string;

  @IsDateString()
  assigned_date: string;

  @IsDateString()
  due_date: string;
}

/** `PATCH /homework-assignments/:id` — deactivate/reactivate only (Q10 D22). */
/** Only ACTIVE/DEACTIVATED are settable via this route (Q10 D22) — SUPERSEDED
 * is set only internally by `HomeworkService.reassign`, so it's excluded
 * from `@IsIn` even though it's a member of the full `HomeworkAssignmentStatus` enum. */
export class UpdateHomeworkAssignmentDto {
  @IsIn([HomeworkAssignmentStatus.ACTIVE, HomeworkAssignmentStatus.DEACTIVATED])
  status: typeof HomeworkAssignmentStatus.ACTIVE | typeof HomeworkAssignmentStatus.DEACTIVATED;
}

export class HomeworkResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() subject_id: string;
  @ApiProperty() class_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ enum: HomeworkGradingMode }) grading_mode: HomeworkGradingMode;
  @ApiProperty({ type: [Object] }) attachments: unknown[];
  @ApiProperty() created_at: Date;
}

export class HomeworkAssignmentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() homework_id: string;
  @ApiProperty({ nullable: true }) section_id: string | null;
  @ApiProperty({ nullable: true }) student_id: string | null;
  @ApiProperty() assigned_date: string;
  @ApiProperty() due_date: string;
  @ApiProperty({ enum: HomeworkAssignmentStatus }) status: HomeworkAssignmentStatus;
}
