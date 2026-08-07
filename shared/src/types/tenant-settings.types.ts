/**
 * Shape of the JSON blob stored on `schools.settings`. `version` is a
 * discriminator so a future shape change is migratable rather than a
 * breaking read — see server/src/modules/schools for the resolver that
 * merges a partially-configured or `null` blob over defaults.
 *
 * Fields marked `→ secret` in the comments are encrypted at rest (#8.7.8)
 * and write-only over the API (#8.7.9) — the server-side DTOs in
 * `server/src/modules/schools/dto/tenant-settings.dto.ts` mark the same
 * fields with a `@Secret()` decorator so encryption and redaction can find
 * them generically instead of via a hand-maintained path list.
 */
export const TENANT_SETTINGS_SCHEMA_VERSION = 1 as const;

export type NumeralSystem = 'latin' | 'bengali';
export type CurrencyGrouping = 'lakh-crore' | 'thousand';
export type CurrencyPosition = 'prefix' | 'suffix';

export interface RegionCurrencySettings {
  code: string;
  symbol: string;
  position: CurrencyPosition;
  decimals: number;
  grouping: CurrencyGrouping;
}

export interface RegionDateSettings {
  format: string;
  firstDayOfWeek: number;
  calendar: string;
}

export interface RegionPhoneSettings {
  country: string;
  pattern: string;
  example: string;
  displayFormat: string;
}

export interface RegionAddressSettings {
  fields: string[];
  order: string[];
}

export interface RegionAcademicYearSettings {
  startMonth: number;
}

export interface RegionIdentifierSettings {
  national: string;
  student: string;
}

export interface RegionSettings {
  locale: string;
  currency: RegionCurrencySettings;
  numerals: NumeralSystem;
  date: RegionDateSettings;
  phone: RegionPhoneSettings;
  address: RegionAddressSettings;
  academicYear: RegionAcademicYearSettings;
  identifiers: RegionIdentifierSettings;
  timezone: string;
}

export type SmsGatewayName = 'greenweb' | 'mimsms';

export interface GreenwebSmsSettings {
  apiKey: string; // → secret
  apiUrl?: string;
}

export interface MimSmsSettings {
  apiKey: string; // → secret
  senderId: string;
  apiUrl?: string;
}

export interface SmsSettings {
  provider: SmsGatewayName;
  greenweb?: GreenwebSmsSettings;
  mimsms?: MimSmsSettings;
}

export interface WhatsAppSettings {
  phoneNumberId: string;
  apiVersion?: string;
  accessToken: string; // → secret
}

export interface EmailSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  password: string; // → secret
}

export interface MessengerSettings {
  pageId: string;
  accessToken: string; // → secret
}

export interface CommunicationsSettings {
  sms?: SmsSettings;
  whatsapp?: WhatsAppSettings;
  email?: EmailSettings;
  messenger?: MessengerSettings;
}

export interface TenantSettings {
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;
  region?: RegionSettings;
  communications?: CommunicationsSettings;
}
