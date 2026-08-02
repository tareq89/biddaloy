import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  ArrayNotEmpty,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { CommunicationMedium, ReminderBatchStatus } from '@beton-boi/shared';

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
   */
  @IsOptional()
  @IsArray()
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
  /** Recipients deliberately not queued, with the reason for each. */
  skipped: SkippedRecipientDto[];
}
