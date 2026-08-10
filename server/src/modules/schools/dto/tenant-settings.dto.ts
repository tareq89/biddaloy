import { IsIn, IsInt, IsString, IsArray, ArrayNotEmpty, Min, Max, Validate } from 'class-validator';
import { Secret } from '../settings/secret-field.decorator';
import { NestedSettings } from '../settings/nested-settings.decorator';
import { OptionalSetting } from '../settings/optional-setting.decorator';
import { IsRegexSourceConstraint } from '../settings/regex-source.validator';
import { SmsProviderIsConfiguredConstraint } from '../settings/sms-provider-config.validator';
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
  @Validate(IsRegexSourceConstraint)
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
  @Validate(IsRegexSourceConstraint)
  national: string;

  // Empty string is a legitimate "no student-ID format enforced" — see
  // DEFAULT_REGION_SETTINGS — and compiles to a match-everything regex,
  // so it needs no special case here.
  @IsString()
  @Validate(IsRegexSourceConstraint)
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
  @IsString()
  @Secret()
  apiKey: string;

  @OptionalSetting()
  @IsString()
  apiUrl?: string;
}

export class MimSmsDto {
  @IsString()
  @Secret()
  apiKey: string;

  @IsString()
  senderId: string;

  @OptionalSetting()
  @IsString()
  apiUrl?: string;
}

export class SmsSettingsDto {
  @IsIn(['greenweb', 'mimsms'])
  @Validate(SmsProviderIsConfiguredConstraint)
  provider: SmsGatewayName;

  @OptionalSetting()
  @NestedSettings(() => GreenwebSmsDto)
  greenweb?: GreenwebSmsDto;

  @OptionalSetting()
  @NestedSettings(() => MimSmsDto)
  mimsms?: MimSmsDto;
}

export class WhatsAppSettingsDto {
  @IsString()
  phoneNumberId: string;

  @OptionalSetting()
  @IsString()
  apiVersion?: string;

  @IsString()
  @Secret()
  accessToken: string;
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

  @IsString()
  @Secret()
  password: string;
}

export class MessengerSettingsDto {
  @IsString()
  pageId: string;

  @IsString()
  @Secret()
  accessToken: string;
}

export class CommunicationsSettingsDto {
  @OptionalSetting()
  @NestedSettings(() => SmsSettingsDto)
  sms?: SmsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => WhatsAppSettingsDto)
  whatsapp?: WhatsAppSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => EmailSettingsDto)
  email?: EmailSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => MessengerSettingsDto)
  messenger?: MessengerSettingsDto;
}

export class TenantSettingsDto {
  @IsIn([TENANT_SETTINGS_SCHEMA_VERSION])
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;

  @OptionalSetting()
  @NestedSettings(() => RegionSettingsDto)
  region?: RegionSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => CommunicationsSettingsDto)
  communications?: CommunicationsSettingsDto;
}
