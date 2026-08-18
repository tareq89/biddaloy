import { ApiProperty } from '@nestjs/swagger';
import { RegionSettingsDto } from './tenant-settings.dto';

/**
 * Swagger-only shapes for `GET`/`PATCH /schools/:id/settings` — the
 * generated schema previously declared these responses as
 * `Record<string, never>` (an empty object placeholder), because nothing
 * annotated the controller with a concrete response type. These classes
 * exist purely to describe the shape `SchoolsService.getMaskedSettings`
 * actually returns (`settings-mask.util.ts`'s `MaskedSecret` in place of
 * every `@Secret()` field) — the controller still returns the plain
 * object that function produces, not an instance of these classes; there
 * is no `ClassSerializerInterceptor` in this app, so nothing here affects
 * runtime behavior, only the generated `ui/src/api/schema.d.ts` types.
 *
 * `region` is untouched here and reuses `RegionSettingsDto` directly — it
 * carries no secrets, so its read and write shapes are identical.
 */
export class MaskedSecretResponseDto {
  @ApiProperty()
  configured: boolean;

  @ApiProperty({ required: false })
  hint?: string;
}

export class MaskedGreenwebSmsResponseDto {
  @ApiProperty({ type: MaskedSecretResponseDto })
  apiKey: MaskedSecretResponseDto;

  @ApiProperty({ required: false })
  apiUrl?: string;
}

export class MaskedMimSmsResponseDto {
  @ApiProperty({ type: MaskedSecretResponseDto })
  apiKey: MaskedSecretResponseDto;

  @ApiProperty()
  senderId: string;

  @ApiProperty({ required: false })
  apiUrl?: string;
}

export class MaskedSmsSettingsResponseDto {
  @ApiProperty()
  provider: string;

  @ApiProperty({ type: MaskedGreenwebSmsResponseDto, required: false })
  greenweb?: MaskedGreenwebSmsResponseDto;

  @ApiProperty({ type: MaskedMimSmsResponseDto, required: false })
  mimsms?: MaskedMimSmsResponseDto;
}

export class MaskedWhatsAppSettingsResponseDto {
  @ApiProperty()
  phoneNumberId: string;

  @ApiProperty({ required: false })
  apiVersion?: string;

  @ApiProperty({ type: MaskedSecretResponseDto })
  accessToken: MaskedSecretResponseDto;
}

export class MaskedEmailSettingsResponseDto {
  @ApiProperty()
  host: string;

  @ApiProperty()
  port: number;

  @ApiProperty()
  user: string;

  @ApiProperty()
  from: string;

  @ApiProperty({ type: MaskedSecretResponseDto })
  password: MaskedSecretResponseDto;
}

export class MaskedMessengerSettingsResponseDto {
  @ApiProperty()
  pageId: string;

  @ApiProperty({ type: MaskedSecretResponseDto })
  accessToken: MaskedSecretResponseDto;
}

export class MaskedCommunicationsSettingsResponseDto {
  @ApiProperty({ type: MaskedSmsSettingsResponseDto, required: false })
  sms?: MaskedSmsSettingsResponseDto;

  @ApiProperty({ type: MaskedWhatsAppSettingsResponseDto, required: false })
  whatsapp?: MaskedWhatsAppSettingsResponseDto;

  @ApiProperty({ type: MaskedEmailSettingsResponseDto, required: false })
  email?: MaskedEmailSettingsResponseDto;

  @ApiProperty({ type: MaskedMessengerSettingsResponseDto, required: false })
  messenger?: MaskedMessengerSettingsResponseDto;
}

export class TenantSettingsResponseDto {
  @ApiProperty()
  version: number;

  @ApiProperty({ type: RegionSettingsDto, required: false })
  region?: RegionSettingsDto;

  @ApiProperty({ type: MaskedCommunicationsSettingsResponseDto, required: false })
  communications?: MaskedCommunicationsSettingsResponseDto;
}
