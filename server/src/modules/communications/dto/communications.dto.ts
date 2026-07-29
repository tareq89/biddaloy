import { IsString, IsOptional, IsUUID, IsArray, IsEnum, IsNotEmpty } from 'class-validator';
import { CommunicationMedium, CommunicationStatus } from '@beton-boi/shared';

export class SendCommunicationDto {
  @IsEnum(CommunicationMedium)
  medium: CommunicationMedium;

  @IsString()
  @IsNotEmpty()
  recipient_address: string;

  @IsString()
  @IsNotEmpty()
  recipient_name: string;

  @IsString()
  @IsNotEmpty()
  message_body: string;

  @IsOptional()
  @IsString()
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
