import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ArrayNotEmpty,
  Min,
  Max,
} from 'class-validator';
import { Secret } from '../settings/secret-field.decorator';
import { NestedSettings } from '../settings/nested-settings.decorator';
import type {
  NumeralSystem,
  CurrencyGrouping,
  CurrencyPosition,
  SmsGatewayName,
} from '@beton-boi/shared';

/**
 * Mirrors `TENANT_SETTINGS_SCHEMA_VERSION` from `@beton-boi/shared` as a
 * local literal rather than a runtime import of it. A static import of a
 * value added to the shared barrel resolves to `undefined` under this
 * repo's vitest config (`resolve.alias` pointing `@beton-boi/shared` at
 * workspace `src/`, not `dist/`) — see the comment on `SanitizeText` in
 * `common/decorators/sanitize-text.decorator.ts` for the full story. A
 * single-literal constant isn't worth the `require()` workaround; the two
 * must simply be kept in sync, which `tenant-settings-defaults.spec.ts`
 * guards against drifting silently.
 */
export const TENANT_SETTINGS_SCHEMA_VERSION = 1 as const;

export class RegionCurrencyDto {
  @IsString()
  code: string;

  @IsString()
  symbol: string;

  @IsIn(['prefix', 'suffix'])
  position: CurrencyPosition;

  @IsInt()
  @Min(0)
  @Max(4)
  decimals: number;

  @IsIn(['lakh-crore', 'thousand'])
  grouping: CurrencyGrouping;
}

export class RegionDateDto {
  @IsString()
  format: string;

  @IsInt()
  @Min(0)
  @Max(6)
  firstDayOfWeek: number;

  @IsString()
  calendar: string;
}

export class RegionPhoneDto {
  @IsString()
  country: string;

  @IsString()
  pattern: string;

  @IsString()
  example: string;

  @IsString()
  displayFormat: string;
}

export class RegionAddressDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  fields: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  order: string[];
}

export class RegionAcademicYearDto {
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth: number;
}

export class RegionIdentifiersDto {
  @IsString()
  national: string;

  @IsString()
  student: string;
}

export class RegionSettingsDto {
  @IsString()
  locale: string;

  @NestedSettings(() => RegionCurrencyDto)
  currency: RegionCurrencyDto;

  @IsIn(['latin', 'bengali'])
  numerals: NumeralSystem;

  @NestedSettings(() => RegionDateDto)
  date: RegionDateDto;

  @NestedSettings(() => RegionPhoneDto)
  phone: RegionPhoneDto;

  @NestedSettings(() => RegionAddressDto)
  address: RegionAddressDto;

  @NestedSettings(() => RegionAcademicYearDto)
  academicYear: RegionAcademicYearDto;

  @NestedSettings(() => RegionIdentifiersDto)
  identifiers: RegionIdentifiersDto;

  @IsString()
  timezone: string;
}

export class GreenwebSmsDto {
  // Optional + nullable: omitting the key leaves the stored secret
  // unchanged (a PATCH doesn't have to resend a credential it isn't
  // touching); an explicit `null` clears it. See
  // `tenant-settings-merge.util.ts`'s `deepMergeCommunications` for the
  // write side of this contract, and `../schools.controller.ts` for why
  // a *read* never round-trips the real value here regardless.
  @IsOptional()
  @IsString()
  @Secret()
  apiKey?: string | null;

  @IsOptional()
  @IsString()
  apiUrl?: string;
}

export class MimSmsDto {
  @IsOptional()
  @IsString()
  @Secret()
  apiKey?: string | null;

  @IsString()
  senderId: string;

  @IsOptional()
  @IsString()
  apiUrl?: string;
}

export class SmsSettingsDto {
  @IsIn(['greenweb', 'mimsms'])
  provider: SmsGatewayName;

  @IsOptional()
  @NestedSettings(() => GreenwebSmsDto)
  greenweb?: GreenwebSmsDto;

  @IsOptional()
  @NestedSettings(() => MimSmsDto)
  mimsms?: MimSmsDto;
}

export class WhatsAppSettingsDto {
  @IsString()
  phoneNumberId: string;

  @IsOptional()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsString()
  @Secret()
  accessToken?: string | null;
}

export class EmailSettingsDto {
  @IsString()
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsString()
  user: string;

  @IsString()
  from: string;

  @IsOptional()
  @IsString()
  @Secret()
  password?: string | null;
}

export class MessengerSettingsDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  @Secret()
  accessToken?: string | null;
}

export class CommunicationsSettingsDto {
  @IsOptional()
  @NestedSettings(() => SmsSettingsDto)
  sms?: SmsSettingsDto;

  @IsOptional()
  @NestedSettings(() => WhatsAppSettingsDto)
  whatsapp?: WhatsAppSettingsDto;

  @IsOptional()
  @NestedSettings(() => EmailSettingsDto)
  email?: EmailSettingsDto;

  @IsOptional()
  @NestedSettings(() => MessengerSettingsDto)
  messenger?: MessengerSettingsDto;
}

export class TenantSettingsDto {
  @IsIn([TENANT_SETTINGS_SCHEMA_VERSION])
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;

  @IsOptional()
  @NestedSettings(() => RegionSettingsDto)
  region?: RegionSettingsDto;

  @IsOptional()
  @NestedSettings(() => CommunicationsSettingsDto)
  communications?: CommunicationsSettingsDto;
}
