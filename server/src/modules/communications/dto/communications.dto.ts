import { IsString, IsOptional, IsUUID, IsArray, IsEnum, IsNotEmpty } from 'class-validator';
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
