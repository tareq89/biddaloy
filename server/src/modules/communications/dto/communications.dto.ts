import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class SendCommunicationDto {
  @IsEnum(CommunicationMedium)
  medium: CommunicationMedium;

  @IsString()
  @IsNotEmpty()
  recipient_address: string;

  @IsString()
  @IsNotEmpty()
  @SanitizeText()
  recipient_name: string;

  // Not sanitized: this is the actual message content sent to the
  // recipient's inbox/SMS/WhatsApp, authored by staff (ADMIN/ACCOUNTANT/
  // EXECUTIVE — see CommunicationsController's @Roles), the same trust
  // boundary as reminder message_template. Free-text *identity* data
  // (names, addresses) is sanitized; staff-authored message bodies are not.
  @IsString()
  @IsNotEmpty()
  message_body: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  subject?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsUUID()
  guardian_id?: string;

  // WhatsApp template sends only — see WhatsAppCloudProvider for the
  // 24-hour freeform-window constraint this exists to work around.
  @IsOptional()
  @IsString()
  template_name?: string;

  @IsOptional()
  @IsString()
  template_language?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  template_params?: string[];
}

export class CommunicationResponseDto {
  id: string;
  medium: CommunicationMedium;
  recipient_address: string;
  recipient_name: string;
  status: CommunicationStatus;
  provider_message_id: string | null;
  created_at: Date;
}

/** [8.10.4]'s dues queue "Last reminder" column — one batch lookup for a
 * page's worth of students instead of one request per row. `student_ids`
 * arrives as a comma-joined query string (`?student_ids=a,b,c`), same
 * shape a `<Link search={{ student_ids: [...] }}>` produces. */
export class QueryLastRemindersDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  student_ids: string[];
}

export class LastReminderDto {
  student_id: string;
  sent_at: Date;
  medium: CommunicationMedium;
}
