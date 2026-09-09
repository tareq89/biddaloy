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
import { ApiProperty } from '@nestjs/swagger';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { CommunicationLogMedium, PUSH_MEDIUM } from '../entities/communication-log.entity';

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
  // A plain `medium: CommunicationLogMedium` (a `CommunicationMedium |
  // 'PUSH'` union, not an enum) can't be introspected by the
  // `@nestjs/swagger` CLI plugin, which only reads real TS enums — the
  // generated schema silently drops `PUSH`. Spell it out explicitly so
  // `PUSH` round-trips into `ui/src/api/schema.d.ts`.
  @ApiProperty({ enum: [...Object.values(CommunicationMedium), PUSH_MEDIUM] })
  medium: CommunicationLogMedium;
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
  // A plain `CommunicationLogMedium` union isn't reliably introspected by
  // the `@nestjs/swagger` CLI plugin (it can silently emit an empty
  // `{ type: 'object' }` schema instead of the enum) — see
  // `CommunicationResponseDto.medium`'s own comment above. Spelled out
  // explicitly here too so `ui/src/api/schema.d.ts` stays deterministic.
  @ApiProperty({ enum: [...Object.values(CommunicationMedium), PUSH_MEDIUM] })
  medium: CommunicationLogMedium;
}
