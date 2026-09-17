import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantSettingsDto, TENANT_SETTINGS_SCHEMA_VERSION } from './tenant-settings.dto';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  DEFAULT_REGION_SETTINGS,
} from '../settings/tenant-settings-defaults';

// Matches the global pipe in server/src/validation-pipe.ts (buildValidationPipeOptions()),
// which SchoolsController's @Body() dto: TenantSettingsDto actually runs
// through in production — this proves the same rejection behaviour
// directly against the schema, without needing to boot a controller.
const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

function toDto(plain: Record<string, unknown>): TenantSettingsDto {
  return plainToInstance(TenantSettingsDto, plain);
}

describe('TenantSettingsDto', () => {
  it('accepts a fully-specified settings blob', async () => {
    const dto = toDto({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      region: DEFAULT_REGION_SETTINGS,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: 'token' },
      },
    });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors).toEqual([]);
  });

  it('requires version', async () => {
    const dto = toDto({ region: DEFAULT_REGION_SETTINGS });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'version')).toBe(true);
  });

  it('rejects a version other than the current schema version', async () => {
    const dto = toDto({ version: 2, region: DEFAULT_REGION_SETTINGS });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'version')).toBe(true);
  });

  it('rejects an unknown top-level key instead of silently persisting it', async () => {
    const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, branding: { logoUrl: 'x' } });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'branding')).toBe(true);
  });

  it('rejects an unknown nested key', async () => {
    const dto = toDto({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'token', extra: 'nope' } },
    });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    const whatsappError = errors
      .find((e) => e.property === 'communications')
      ?.children?.find((e) => e.property === 'whatsapp');
    expect(whatsappError?.children?.some((e) => e.property === 'extra')).toBe(true);
  });

  it('rejects an incomplete nested section (region without currency)', async () => {
    const { currency: _currency, ...regionWithoutCurrency } = DEFAULT_REGION_SETTINGS;
    const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, region: regionWithoutCurrency });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    const regionErrors = errors.find((e) => e.property === 'region');
    expect(regionErrors?.children?.some((e) => e.property === 'currency')).toBe(true);
  });

  // `null` is not a shape TenantSettings permits anywhere: a section is
  // present and well-formed, or omitted. class-validator's own
  // `@IsOptional()` treats `null` as "skip everything", which would have
  // let these persist — hence `@OptionalSetting()`.
  describe('null handling', () => {
    it('rejects null for an optional nested section', async () => {
      const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, communications: null });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.some((e) => e.property === 'communications')).toBe(true);
    });

    it('rejects null for an optional scalar', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'greenweb', greenweb: { apiKey: 'k', apiUrl: null } },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const greenwebError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'sms')
        ?.children?.find((e) => e.property === 'greenweb');
      expect(greenwebError?.children?.some((e) => e.property === 'apiUrl')).toBe(true);
    });

    it('still accepts an omitted optional field', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'k' } } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });
  });

  // A config naming one gateway while configuring another validates
  // structurally but leaves the tenant unable to send — the resolver
  // (#8.7.10) looks up `sms[provider]` and finds nothing. Caught here so
  // it fails on the request that caused it, not inside a queued job.
  describe('sms provider/config coherence', () => {
    it('rejects a provider whose config block is missing', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'mimsms' } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const smsError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'sms');
      expect(smsError?.children?.some((e) => e.property === 'provider')).toBe(true);
    });

    it('rejects a config that names one gateway and configures the other', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'greenweb', mimsms: { apiKey: 'k', senderId: 'BIDDALOY' } },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const smsError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'sms');
      expect(smsError?.children?.some((e) => e.property === 'provider')).toBe(true);
    });

    it('accepts the selected gateway being configured', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'k' } } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });

    it('accepts both gateways configured — switching between them is legitimate', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: {
            provider: 'mimsms',
            greenweb: { apiKey: 'k' },
            mimsms: { apiKey: 'k2', senderId: 'BIDDALOY' },
          },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });
  });

  // These fields travel as regex *source* strings and get compiled with
  // `new RegExp()` by consumers. An uncompilable one saved once breaks
  // validation for the whole tenant at read time, in every consumer.
  describe('regex-source fields', () => {
    it('rejects a phone pattern that cannot compile', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          phone: { ...DEFAULT_REGION_SETTINGS.phone, pattern: '^(01[3-9]' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const phoneError = errors
        .find((e) => e.property === 'region')
        ?.children?.find((e) => e.property === 'phone');
      expect(phoneError?.children?.some((e) => e.property === 'pattern')).toBe(true);
    });

    it('rejects an identifier pattern that cannot compile', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          identifiers: { national: '[unterminated', student: '' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const identifiersError = errors
        .find((e) => e.property === 'region')
        ?.children?.find((e) => e.property === 'identifiers');
      expect(identifiersError?.children?.some((e) => e.property === 'national')).toBe(true);
    });

    it('accepts the shipped defaults, which are themselves regex sources', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: DEFAULT_REGION_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });
  });

  describe('secret fields — #8.7.9 PATCH contract (omit leaves unchanged, null clears)', () => {
    it('accepts a medium with its secret field omitted entirely', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: { phoneNumberId: '123' } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });

    it('accepts an explicit null on a secret field', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: { phoneNumberId: '123', accessToken: null } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });

    it('still rejects a non-string, non-null value on a secret field', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: { phoneNumberId: '123', accessToken: 42 } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const whatsappError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'whatsapp');
      expect(whatsappError?.children?.some((e) => e.property === 'accessToken')).toBe(true);
    });

    it('rejects an empty string on a secret field — not a fourth clearing idiom alongside omit/null', async () => {
      // '' is what a controlled text input produces when a user selects a
      // populated password field and deletes it — it must not silently
      // pass @IsOptional()+@IsString() and bypass encryption downstream.
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: { phoneNumberId: '123', accessToken: '' } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const whatsappError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'whatsapp');
      expect(whatsappError?.children?.some((e) => e.property === 'accessToken')).toBe(true);
    });

    it('still requires a non-secret field on a medium even when the secret is omitted', async () => {
      // phoneNumberId is required regardless of accessToken's optionality.
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: {} },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const whatsappError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'whatsapp');
      expect(whatsappError?.children?.some((e) => e.property === 'phoneNumberId')).toBe(true);
    });
  });

  // [17.2.3] `region.country` (D11) and `region.calendar.termLabel`.
  describe('region — country and calendar', () => {
    it('accepts the default region, which already carries country + calendar.termLabel', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: DEFAULT_REGION_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'region')).toBeUndefined();
    });

    // Chosen behaviour, documented here rather than left ambiguous: a
    // lowercase code is rejected outright, not silently upper-cased. See
    // the comment on `RegionSettingsDto.country` for why one decorator
    // (`@IsISO31661Alpha2`) alone would not be enough.
    it('rejects a lowercase country code instead of normalising it', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: { ...DEFAULT_REGION_SETTINGS, country: 'bd' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      expect(regionError?.children?.some((e) => e.property === 'country')).toBe(true);
    });

    it('rejects a country code that is not a real ISO 3166-1 alpha-2 code', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: { ...DEFAULT_REGION_SETTINGS, country: 'ZZ' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      expect(regionError?.children?.some((e) => e.property === 'country')).toBe(true);
    });

    it('rejects a calendar.termLabel outside the TermLabel enum', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          calendar: { termLabel: 'QUARTER' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      const calendarError = regionError?.children?.find((e) => e.property === 'calendar');
      expect(calendarError?.children?.some((e) => e.property === 'termLabel')).toBe(true);
    });

    it('still accepts region with calendar omitted — it is optional', async () => {
      const { calendar: _calendar, ...regionWithoutCalendar } = DEFAULT_REGION_SETTINGS;
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: regionWithoutCalendar,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'region')).toBeUndefined();
    });
  });

  describe('attendance', () => {
    it('accepts a full valid attendance section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: DEFAULT_ATTENDANCE_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'attendance')).toBeUndefined();
    });

    it('rejects a weeklyOffDays entry outside 0-6', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, weeklyOffDays: [7] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(attendanceError?.children?.some((e) => e.property === 'weeklyOffDays')).toBe(true);
    });

    it('rejects a lateAfter value outside HH:mm', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, lateAfter: '25:00' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(attendanceError?.children?.some((e) => e.property === 'lateAfter')).toBe(true);
    });

    it('rejects a lowAttendanceThresholdPercent above 100', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, lowAttendanceThresholdPercent: 101 },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(
        attendanceError?.children?.some((e) => e.property === 'lowAttendanceThresholdPercent'),
      ).toBe(true);
    });
  });

  describe('auth', () => {
    it('accepts a valid auth section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        auth: DEFAULT_AUTH_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'auth')).toBeUndefined();
    });

    it('rejects a non-boolean otpLoginEnabled', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        auth: { otpLoginEnabled: 'yes' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const authError = errors.find((e) => e.property === 'auth');
      expect(authError?.children?.some((e) => e.property === 'otpLoginEnabled')).toBe(true);
    });
  });

  // [15.6/#508 D5] `sms.metering` — absent ⇒ OFF (unmetered, today's
  // behaviour). Only #545 (this schema); #546/#547 wire up the metering
  // itself.
  describe('sms.metering', () => {
    it('accepts an sms section with no metering key at all', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'k' } } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });

    it('accepts metering: OFF and metering: PLATFORM', async () => {
      for (const metering of ['OFF', 'PLATFORM'] as const) {
        const dto = toDto({
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          communications: {
            sms: { provider: 'greenweb', greenweb: { apiKey: 'k' }, metering },
          },
        });

        const errors = await validate(dto, VALIDATION_OPTIONS);

        expect(errors).toEqual([]);
      }
    });

    it('rejects a metering value outside OFF/PLATFORM', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'greenweb', greenweb: { apiKey: 'k' }, metering: 'BOGUS' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const smsError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'sms');
      expect(smsError?.children?.some((e) => e.property === 'metering')).toBe(true);
    });

    it('rejects null for metering (omit to leave unset, not null)', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'greenweb', greenweb: { apiKey: 'k' }, metering: null },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const smsError = errors
        .find((e) => e.property === 'communications')
        ?.children?.find((e) => e.property === 'sms');
      expect(smsError?.children?.some((e) => e.property === 'metering')).toBe(true);
    });
  });

  // [16.2.1] `settings.fees` — who may approve, and how, is data.
  describe('fees', () => {
    it('accepts a valid fees section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'OTP_OR_PASSWORD',
          notifyOnManualGenerationDefault: true,
          notifyOnScheduleDefault: false,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'fees')).toBeUndefined();
    });

    it('rejects an invalid approvalMode', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'BOGUS',
          notifyOnManualGenerationDefault: false,
          notifyOnScheduleDefault: true,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const feesError = errors.find((e) => e.property === 'fees');
      expect(feesError?.children?.some((e) => e.property === 'approvalMode')).toBe(true);
    });

    it('rejects a non-boolean notifyOnManualGenerationDefault/notifyOnScheduleDefault', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'OTP',
          notifyOnManualGenerationDefault: 'yes',
          notifyOnScheduleDefault: 'no',
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const feesError = errors.find((e) => e.property === 'fees');
      expect(
        feesError?.children?.some((e) => e.property === 'notifyOnManualGenerationDefault'),
      ).toBe(true);
      expect(feesError?.children?.some((e) => e.property === 'notifyOnScheduleDefault')).toBe(true);
    });

    describe('lateFees', () => {
      function feesWithLateFees(lateFees: unknown): Record<string, unknown> {
        return {
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          fees: {
            approvalMode: 'OTP',
            notifyOnManualGenerationDefault: false,
            notifyOnScheduleDefault: false,
            lateFees,
          },
        };
      }

      it('accepts a valid lateFees map', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        expect(errors.find((e) => e.property === 'fees')).toBeUndefined();
      });

      it('[CodeRabbit review, PR #801] rejects a fractional grace_days', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 1.5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });

      it('rejects grace_days outside 0-60', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 61, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });

      it('rejects an unknown fee type key', async () => {
        const dto = toDto(
          feesWithLateFees({
            NOT_A_REAL_FEE_TYPE: { enabled: true, grace_days: 5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });
    });
  });
});
