import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';

/** Roles a staff message may name. Guardians, students and platform owners are never staff. */
export const STAFF_AUDIENCE_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
] as const;

const ids = (description: string) =>
  ApiPropertyOptional({ type: [String], format: 'uuid', description });

/** [80.1.04] Who a staff message goes to: the union of every field given (D18). */
export class StaffAudienceDto {
  @ApiPropertyOptional({ enum: STAFF_AUDIENCE_ROLES, isArray: true })
  @IsOptional()
  @IsIn(STAFF_AUDIENCE_ROLES, { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  roles?: UserRole[];

  @ids('Staff whose current designation is one of these.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  designationIds?: string[];

  @ApiPropertyOptional({ description: 'true: teaching staff; false: non-teaching staff.' })
  @IsOptional()
  @IsBoolean()
  teaching?: boolean;

  @ids('Named people of this school.')
  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  userIds?: string[];
}

/** Staff messages go by SMS or WhatsApp only (D33). */
export const STAFF_MESSAGE_MEDIUMS = [
  CommunicationMedium.SMS,
  CommunicationMedium.WHATSAPP,
] as const;

/**
 * [80.1.05] One body for preview and send, so the preview can never validate differently from
 * the send. The text goes out as typed (D9, D24): no placeholders are rendered.
 */
export class StaffMessageDto {
  @ApiProperty({ type: StaffAudienceDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => StaffAudienceDto)
  audience: StaffAudienceDto;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  // Whitespace-only text is not a message. Fixed sentence, never echoes the input.
  @Matches(/\S/, { message: 'Write a message.' })
  @MaxLength(1000)
  message: string;

  @ApiProperty({ enum: STAFF_MESSAGE_MEDIUMS })
  @IsIn(STAFF_MESSAGE_MEDIUMS)
  medium: CommunicationMedium;

  @ApiPropertyOptional({ description: 'Required when medium is WHATSAPP (D33).' })
  @ValidateIf((o: StaffMessageDto) => o.medium === CommunicationMedium.WHATSAPP)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  whatsapp_template_name?: string;

  @ApiPropertyOptional({ description: 'Required when medium is WHATSAPP.' })
  @ValidateIf((o: StaffMessageDto) => o.medium === CommunicationMedium.WHATSAPP)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  whatsapp_template_language?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Literal values for the template {{1}}, {{2}}, ... Required when WHATSAPP.',
  })
  @ValidateIf((o: StaffMessageDto) => o.medium === CommunicationMedium.WHATSAPP)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  whatsapp_template_params?: string[];
}

export class StaffSkippedDto {
  user_id: string;
  name: string;
  reason: string;
}

export class StaffWhatsAppTemplateDto {
  name: string;
  language: string;
  params: string[];
}

export class StaffMessagePreviewResponseDto {
  people: number;
  with_phone: number;
  skipped: StaffSkippedDto[];
  segments_each: number;
  credits_needed: number;
  /** null when the school does not meter SMS credit. */
  balance: number | null;
  shortfall: number;
  /** The template WhatsApp will deliver; null for SMS. */
  @ApiProperty({ type: StaffWhatsAppTemplateDto, nullable: true })
  whatsapp_template: StaffWhatsAppTemplateDto | null;
}

export class StaffMessageSendResponseDto {
  batch_id: string;
  total_recipients: number;
  queued: number;
  failed: number;
  skipped: StaffSkippedDto[];
}
