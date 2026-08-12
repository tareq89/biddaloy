import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';

export class SendSingleReminderDto {
  /**
   * Supports {{student_name}}, {{guardian_name}}, {{due_amount}}, {{due_month}}.
   * Not sanitized: staff-authored content, same reasoning as
   * SendBulkReminderDto.message_template — see reminders.dto.ts.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message_template: string;

  /** Contact exactly these guardians. Omit to default to the primary contact(s). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  /**
   * Overrides every selected guardian's preferred_communication for this
   * send only — never written back to the guardian record. Matches the
   * issue's "override communication medium temporarily."
   */
  @IsOptional()
  @IsEnum(CommunicationMedium)
  medium?: CommunicationMedium;

  // WhatsApp template sends only — see WhatsAppCloudProvider for the
  // 24-hour freeform-window constraint this exists to work around.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  whatsapp_template_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_template_language?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatsapp_template_params?: string[];
}

export class SkippedGuardianDto {
  guardian_id: string;
  guardian_name: string;
  reason: string;
}

export class ReminderPreviewRecipientDto {
  guardian_id: string;
  guardian_name: string;
  medium: CommunicationMedium;
  address: string;
  message_body: string;
  subject: string | null;
}

export class ReminderPreviewResponseDto {
  student_id: string;
  recipients: ReminderPreviewRecipientDto[];
  skipped: SkippedGuardianDto[];
}

export class SentReminderRecipientDto {
  communication_log_id: string;
  guardian_id: string;
  guardian_name: string;
  medium: CommunicationMedium;
  status: CommunicationStatus;
}

export class SingleReminderResponseDto {
  student_id: string;
  sent: SentReminderRecipientDto[];
  skipped: SkippedGuardianDto[];
}
