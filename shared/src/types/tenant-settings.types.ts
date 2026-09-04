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

/**
 * How a school counts attendance. Every attendance percentage and
 * low-attendance flag downstream depends on this, so it lives here and
 * every consumer (marking UI, summaries, exam module in a later epic)
 * reads one policy instead of re-deriving school rules.
 */
export interface AttendancePolicySettings {
  /** 0 = Sunday … 6 = Saturday. Bangladesh default: Friday only. */
  weeklyOffDays: number[];
  /** Local 'HH:mm'. A check-in after this is LATE. */
  lateAfter: string;
  /** Local 'HH:mm'. A check-in after this is ABSENT, not LATE. */
  absentAfter: string;
  /** Days a teacher may edit their own marks without ATTENDANCE_CORRECT. */
  correctionWindowDays: number;
  /** Below this a student is flagged low-attendance. BD board eligibility
   * is commonly 75. */
  lowAttendanceThresholdPercent: number;
  /** Does a LATE day count toward the numerator? */
  lateCountsAsPresent: boolean;
  /** Does an approved LEAVE day stay in the denominator? */
  leaveCountsAsWorkingDay: boolean;
  /** WORKING_DAYS = full calendar. MARKED_DAYS = only days the register
   * was finalized. A school that marks unreliably wants MARKED_DAYS. */
  percentageDenominator: 'WORKING_DAYS' | 'MARKED_DAYS';
  /** Is marking a future date allowed at all, and if so only LEAVE (9.3
   * enforces this). */
  allowFutureDates: boolean;
  autoAbsentNotification: { enabled: boolean; cutoffTime: string };
}

export type SmsGatewayName = 'greenweb' | 'mimsms';

export interface GreenwebSmsSettings {
  apiKey: string | null; // → secret; null = explicitly cleared, see TenantSettingsDto
  apiUrl?: string;
}

export interface MimSmsSettings {
  apiKey: string | null; // → secret; null = explicitly cleared, see TenantSettingsDto
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
  accessToken: string | null; // → secret; null = explicitly cleared, see TenantSettingsDto
}

export interface EmailSettings {
  host: string;
  port: number;
  user: string;
  from: string;
  password: string | null; // → secret; null = explicitly cleared, see TenantSettingsDto
}

export interface MessengerSettings {
  pageId: string;
  accessToken: string | null; // → secret; null = explicitly cleared, see TenantSettingsDto
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
  attendance?: AttendancePolicySettings;
}
