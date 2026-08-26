import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  ArrayNotEmpty,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationMedium, CommunicationStatus, ReminderBatchStatus } from '@biddaloy/shared';
import { ReminderPreviewRecipientDto } from './single-reminder.dto';

/**
 * Upper bound on one batch. The endpoint resolves recipients and enqueues
 * jobs inside the request, so an unbounded list would turn a single call
 * into a long-running write of tens of thousands of rows. Callers with
 * more students than this send several batches.
 */
export const MAX_BULK_REMINDER_STUDENTS = 500;

export class SendBulkReminderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_REMINDER_STUDENTS)
  @IsUUID('4', { each: true })
  student_ids: string[];

  /**
   * Supports {{student_name}}, {{guardian_name}}, {{due_amount}}, {{due_month}}.
   * Not sanitized: staff-authored content (see @Roles on the controller), a
   * higher trust boundary than the identity data it interpolates. The
   * interpolated values are already clean because their sources — Student /
   * Guardian full_name — are sanitized at creation; see
   * reminder-template.util.ts and server/README.md's sanitization note.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message_template: string;

  /**
   * Channels this batch is allowed to use. Omit to accept whatever each
   * guardian prefers; supply a list to restrict the batch to guardians who
   * prefer one of those channels.
   *
   * `@ArrayNotEmpty` because `[]` and "omitted" mean opposite things to a
   * caller — "no channel at all" vs "any channel" — but resolveRecipients
   * collapses both to "any channel". A UI that deselects every channel
   * must get a 400, not a send to everybody.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(CommunicationMedium, { each: true })
  mediums?: CommunicationMedium[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  batch_name?: string;

  /**
   * WhatsApp rejects freeform text outside its 24-hour session window, which
   * a proactive fee reminder is always outside of. Supply a pre-approved
   * template name to make WhatsApp recipients deliverable; without it they
   * are queued as freeform and will be rejected by Meta.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  whatsapp_template_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_template_language?: string;

  /**
   * Placeholder names whose rendered values fill the WhatsApp template's
   * positional parameters, in order — e.g. ["guardian_name","due_amount"]
   * maps to the template's {{1}} and {{2}}. Named rather than positional
   * here so the mapping to an approved template is explicit.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatsapp_template_params?: string[];
}

export class SkippedRecipientDto {
  student_id: string;
  guardian_id: string | null;
  reason: string;
}

export class ReminderBatchResponseDto {
  id: string;
  batch_name: string;
  status: ReminderBatchStatus;
  total_recipients: number;
  successful_count: number;
  failed_count: number;
  message_template: string | null;
  created_at: Date;
  /**
   * The batch's original targeting, replayed from filters_applied so the
   * detail page can retry failures on the same channels with the same
   * approved template. Null mediums means the send used each guardian's
   * preferred channel.
   */
  mediums: CommunicationMedium[] | null;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
  whatsapp_template_params: string[] | null;
  /** Recipients deliberately not queued, with the reason for each. */
  skipped: SkippedRecipientDto[];
}

export class QueryReminderBatchesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Shared page envelope for the reminder history/logs lists. */
export class ReminderPaginatedResponseDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * One row of the Reminder History list. Deliberately excludes `skipped`
 * (potentially hundreds of entries per batch, persisted in
 * filters_applied) — the detail endpoint returns it for one batch at a
 * time instead of every batch on the page carrying its full skip list.
 */
export class ReminderBatchListItemDto {
  id: string;
  batch_name: string;
  status: ReminderBatchStatus;
  total_recipients: number;
  successful_count: number;
  failed_count: number;
  created_at: Date;
}

export class ReminderBatchListResponseDto extends ReminderPaginatedResponseDto {
  data: ReminderBatchListItemDto[];
}

/**
 * A guardian (or a whole student, when guardian_id is null — e.g.
 * no_open_dues / no_guardians) the bulk send would leave out, named so the
 * sender can act on it before anything is sent. Unlike the persisted
 * SkippedRecipientDto this carries guardian_name: preview is exactly the
 * "review before send" step, and a bare UUID is not reviewable.
 */
export class BulkPreviewSkippedDto {
  guardian_id: string | null;
  guardian_name: string | null;
  reason: string;
}

export class BulkPreviewStudentDto {
  student_id: string;
  student_name: string;
  /** Same shape as the single-student preview's recipients. */
  recipients: ReminderPreviewRecipientDto[];
  skipped: BulkPreviewSkippedDto[];
}

export class BulkReminderPreviewResponseDto {
  total_students: number;
  recipients_count: number;
  skipped_count: number;
  students: BulkPreviewStudentDto[];
}

/** Same paging rules as the batch list; logs pages just default larger. */
export class QueryReminderBatchLogsDto extends QueryReminderBatchesDto {
  limit?: number = 50;
}

/**
 * One recipient's delivery record within a batch — the batch detail
 * page's per-recipient status table. `student_id` is what a retry
 * composes its fresh `POST /reminder/bulk` from; `error` surfaces the
 * worker's failure reason (from CommunicationLog.metadata.error) so
 * "FAILED" is never unexplained. Message bodies are deliberately
 * excluded — `GET /communications/:id` serves the single-log drill-down.
 */
export class ReminderBatchLogDto {
  id: string;
  medium: CommunicationMedium;
  recipient_address: string;
  recipient_name: string;
  status: CommunicationStatus;
  student_id: string | null;
  guardian_id: string | null;
  provider_message_id: string | null;
  error: string | null;
  created_at: Date;
}

export class ReminderBatchLogListResponseDto extends ReminderPaginatedResponseDto {
  data: ReminderBatchLogDto[];
}
