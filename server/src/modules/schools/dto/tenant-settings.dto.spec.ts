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
});
