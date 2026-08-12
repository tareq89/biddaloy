import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantSettingsDto, TENANT_SETTINGS_SCHEMA_VERSION } from './tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from '../settings/tenant-settings-defaults';

// Matches the global pipe in server/src/validation-pipe.ts, so this proves
// the same rejection behaviour the app enforces at the controller boundary
// (which #8.7.9 wires up) — no controller exists on this branch yet.
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
});
