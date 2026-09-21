import {
  IsIn,
  IsInt,
  IsString,
  IsArray,
  IsBoolean,
  ArrayNotEmpty,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  Matches,
  Min,
  Max,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Secret } from '../settings/secret-field.decorator';
import { NestedSettings } from '../settings/nested-settings.decorator';
import { OptionalSetting } from '../settings/optional-setting.decorator';
import { IsRegexSourceConstraint } from '../settings/regex-source.validator';
import { SmsProviderIsConfiguredConstraint } from '../settings/sms-provider-config.validator';
import { UniqueLabelListConstraint } from '../settings/unique-labels.validator';
import { ApprovalMode, DiscountKind, FeeType, TermLabel } from '@biddaloy/shared';
import type {
  NumeralSystem,
  CurrencyGrouping,
  CurrencyPosition,
  SmsGatewayName,
  SmsMeteringMode,
  BackupScheduleMode,
} from '@biddaloy/shared';

/**
 * Mirrors `TENANT_SETTINGS_SCHEMA_VERSION` from `@biddaloy/shared` as a
 * local literal rather than a runtime import of it. A static import of a
 * value added to the shared barrel resolves to `undefined` under this
 * repo's vitest config (`resolve.alias` pointing `@biddaloy/shared` at
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

/**
 * `region.calendar` (17.1.1/17.1.2) — what a tenant calls a grading period
 * on its academic calendar. Optional: a tenant with no calendar settings
 * yet resolves to `TermLabel.TERM` via `DEFAULT_REGION_SETTINGS`.
 */
export class RegionCalendarDto {
  @IsIn(Object.values(TermLabel))
  termLabel: TermLabel;
}

export class RegionSettingsDto {
  @IsString()
  locale: string;

  // ISO 3166-1 alpha-2, e.g. 'BD' (D11) — picks the default public-holiday
  // source for a tenant's calendar (Epic 17).
  // `@Matches` keeps case strict (rejects 'bd') — `@IsISO31661Alpha2` alone
  // is case-insensitive per its underlying `validator` library, so on its
  // own it would accept a lowercase code and store it un-normalised,
  // producing a value like 'bd' next to `DEFAULT_REGION_SETTINGS.country`'s
  // 'BD'. Chosen behaviour: reject anything but a real, uppercase ISO
  // 3166-1 alpha-2 code (`tenant-settings.dto.spec.ts` documents this).
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code, e.g. BD' })
  @IsISO31661Alpha2({ message: 'country must be a real ISO 3166-1 alpha-2 country code' })
  country: string;

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

  @OptionalSetting()
  @NestedSettings(() => RegionCalendarDto)
  calendar?: RegionCalendarDto;
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
  @IsNotEmpty() // `null` clears the secret; `''` is a client bug, not a third clearing idiom
  @Secret()
  apiKey?: string | null;

  @OptionalSetting()
  @IsString()
  apiUrl?: string;
}

export class MimSmsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty() // `null` clears the secret; `''` is a client bug, not a third clearing idiom
  @Secret()
  apiKey?: string | null;

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

  // [15.6/#508 D5] Absent ⇒ OFF (today's unmetered behaviour). PLATFORM
  // turns on metering against sms_credit_ledger/sms_credit_balance (#546).
  @OptionalSetting()
  @IsIn(['OFF', 'PLATFORM'])
  metering?: SmsMeteringMode;
}

export class WhatsAppSettingsDto {
  @IsString()
  phoneNumberId: string;

  @OptionalSetting()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty() // `null` clears the secret; `''` is a client bug, not a third clearing idiom
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
  @IsNotEmpty() // `null` clears the secret; `''` is a client bug, not a third clearing idiom
  @Secret()
  password?: string | null;
}

export class MessengerSettingsDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty() // `null` clears the secret; `''` is a client bug, not a third clearing idiom
  @Secret()
  accessToken?: string | null;
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

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AutoAbsentNotificationDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(HH_MM_PATTERN)
  cutoffTime: string;
}

export class AttendancePolicyDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffDays: number[];

  @IsString()
  @Matches(HH_MM_PATTERN)
  lateAfter: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  absentAfter: string;

  @IsInt()
  @Min(0)
  @Max(365)
  correctionWindowDays: number;

  @IsInt()
  @Min(0)
  @Max(100)
  lowAttendanceThresholdPercent: number;

  @IsBoolean()
  lateCountsAsPresent: boolean;

  @IsBoolean()
  leaveCountsAsWorkingDay: boolean;

  @IsIn(['WORKING_DAYS', 'MARKED_DAYS'])
  percentageDenominator: 'WORKING_DAYS' | 'MARKED_DAYS';

  @IsBoolean()
  allowFutureDates: boolean;

  @NestedSettings(() => AutoAbsentNotificationDto)
  autoAbsentNotification: AutoAbsentNotificationDto;
}

/**
 * `organisation.{shifts,versions,groups}` (33.1.1) — a tenant's own
 * vocabulary for shift/version/group. Each list: trimmed non-empty entries,
 * at most 50 characters, at most 20 entries, no case-insensitive duplicate.
 */
export class OrganisationSettingsDto {
  @IsArray()
  @Validate(UniqueLabelListConstraint)
  shifts: string[];

  @IsArray()
  @Validate(UniqueLabelListConstraint)
  versions: string[];

  @IsArray()
  @Validate(UniqueLabelListConstraint)
  groups: string[];
}

/**
 * Per-tenant login policy (12.5). `otpLoginEnabled` is a school's off-switch
 * for passwordless phone+OTP sign-in — not a secret, no `@Secret()`. A user
 * with memberships in several tenants is allowed OTP login only if *every*
 * tenant they belong to has this `!== false` (deny wins) — see
 * `OtpLoginService.allowed`.
 */
export class AuthSettingsDto {
  @IsBoolean()
  otpLoginEnabled: boolean;
}

/**
 * `backup.schedule` (14.12.1/#615 D10) — not a secret, no `@Secret()`.
 */
export class BackupSettingsDto {
  @IsIn(['OFF', 'WEEKLY', 'DAILY'])
  schedule: BackupScheduleMode;
}

/**
 * One fee type's late-fee rule, `settings.fees.lateFees[feeType]` (16.7.4).
 * `LateFeeService.applyDue` reads this per fee type — `enabled: false` (or
 * the fee type simply absent from the map) means that fee type never gets
 * a late-fee bill.
 */
export class LateFeeRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @IsInt()
  @Min(0)
  @Max(60)
  grace_days: number;

  @ApiProperty({ enum: DiscountKind })
  @IsIn(Object.values(DiscountKind))
  kind: DiscountKind;

  @ApiProperty()
  @IsNotEmpty()
  value: number;
}

/**
 * `lateFees`'s keys are `FeeType` values — validated by hand rather than
 * `@ValidateNested()` (which needs a fixed property list, not an
 * arbitrary-key map) against each value's `LateFeeRuleDto` shape.
 */
@ValidatorConstraint({ name: 'isLateFeesMap', async: false })
export class LateFeesMapConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.lastError = 'lateFees must be an object keyed by fee type';
      return false;
    }
    for (const [feeType, rule] of Object.entries(value as Record<string, unknown>)) {
      if (!Object.values(FeeType).includes(feeType as FeeType)) {
        this.lastError = `"${feeType}" is not a known fee type`;
        return false;
      }
      if (typeof rule !== 'object' || rule === null) {
        this.lastError = `lateFees.${feeType} must be an object`;
        return false;
      }
      const r = rule as Record<string, unknown>;
      if (typeof r.enabled !== 'boolean') {
        this.lastError = `lateFees.${feeType}.enabled must be a boolean`;
        return false;
      }
      if (
        !Number.isInteger(r.grace_days) ||
        (r.grace_days as number) < 0 ||
        (r.grace_days as number) > 60
      ) {
        this.lastError = `lateFees.${feeType}.grace_days must be an integer 0-60`;
        return false;
      }
      if (!Object.values(DiscountKind).includes(r.kind as DiscountKind)) {
        this.lastError = `lateFees.${feeType}.kind must be PERCENT or FLAT`;
        return false;
      }
      if (typeof r.value !== 'number' || r.value < 0) {
        this.lastError = `lateFees.${feeType}.value must be a non-negative number`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.lastError || 'lateFees is invalid';
  }
}

/**
 * `settings.fees` (16.2.1) — who may approve, and how, is data. `approvalMode`
 * is what `SchoolSettingsReader.feesApprovalMode` (16.2.2's step-up approval
 * flow) reads to decide whether PASSWORD is an allowed verification method
 * alongside OTP.
 */
@ApiExtraModels(LateFeeRuleDto)
export class FeesSettingsDto {
  @ApiProperty({ enum: ApprovalMode })
  @IsIn(Object.values(ApprovalMode))
  approvalMode: ApprovalMode;

  @ApiProperty()
  @IsBoolean()
  notifyOnManualGenerationDefault: boolean;

  @ApiProperty()
  @IsBoolean()
  notifyOnScheduleDefault: boolean;

  /** [16.7.4] Per-fee-type late-fee rule. Omitted/absent fee type = no
   * late fee ever applies to that fee type.
   *
   * [CodeRabbit review, PR #801] `@ApiPropertyOptional` here is load-bearing,
   * not decorative: nestjs/swagger's CLI-plugin reflection can describe a
   * plain class property automatically, but not a mapped type like
   * `Partial<Record<FeeType, LateFeeRuleDto>>` — without this, the
   * generated OpenAPI (and therefore ui/src/api/schema.d.ts) described
   * `lateFees` as `Record<string, never>`, which rejected every real
   * field (`enabled`, `grace_days`, `kind`, `value`) at the UI's type
   * level even though the server accepted and validated them correctly. */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(LateFeeRuleDto) },
    description: 'Keyed by FeeType. Omitted key = that fee type never gets a late fee.',
  })
  @IsOptional()
  @Validate(LateFeesMapConstraint)
  lateFees?: Partial<Record<FeeType, LateFeeRuleDto>>;
}

/**
 * [33.3.1] An explicit rename instruction for one `organisation` vocabulary
 * list, carried alongside a settings PATCH rather than inferred from the
 * `organisation` diff itself — inferring "Morning removed, Prabhati added"
 * as a rename would turn an unrelated delete-then-add into a silent mass
 * `UPDATE` of every `classes`/`class_sections` row using the deleted value.
 * `SchoolsService.updateSettings` strips this out of the persisted
 * `settings` jsonb before merging (it's an instruction *for* this write,
 * not a stored setting) and uses it to rewrite affected rows in the same
 * transaction as the settings save.
 */
export class OrganisationRenameDto {
  @IsIn(['shifts', 'versions', 'groups'])
  list: 'shifts' | 'versions' | 'groups';

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

export class TenantSettingsDto {
  @IsIn([TENANT_SETTINGS_SCHEMA_VERSION])
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;

  /** [33.3.1] See `OrganisationRenameDto`. Not part of the stored settings
   * shape — a write instruction only. */
  @ApiPropertyOptional({ type: [OrganisationRenameDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrganisationRenameDto)
  organisationRenames?: OrganisationRenameDto[];

  @OptionalSetting()
  @NestedSettings(() => RegionSettingsDto)
  region?: RegionSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => CommunicationsSettingsDto)
  communications?: CommunicationsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => AttendancePolicyDto)
  attendance?: AttendancePolicyDto;

  @OptionalSetting()
  @NestedSettings(() => OrganisationSettingsDto)
  organisation?: OrganisationSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => AuthSettingsDto)
  auth?: AuthSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => BackupSettingsDto)
  backup?: BackupSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => FeesSettingsDto)
  fees?: FeesSettingsDto;
}
