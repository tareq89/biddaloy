import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from './region-config';
import { resolveRegionConfig } from './region-config-resolver';

describe('resolveRegionConfig', () => {
  it('returns the fallback unchanged when the tenant has no region settings', () => {
    expect(resolveRegionConfig(REGION_BD_BN, undefined)).toBe(REGION_BD_BN);
  });

  it('uses every tenant-provided field when the tenant fully overrides the region', () => {
    const tenantRegion = {
      locale: 'en-US',
      numerals: 'latin' as const,
      timezone: 'America/New_York',
      currency: {
        code: 'USD',
        symbol: '$',
        position: 'prefix' as const,
        decimals: 2,
        grouping: 'thousand' as const,
      },
      date: { format: 'MM/DD/YYYY', firstDayOfWeek: 0, calendar: 'gregory' },
      phone: {
        country: '1',
        pattern: '^\\d{10}$',
        example: '2125551234',
        displayFormat: 'XXX-XXX-XXXX',
      },
      address: {
        fields: ['street', 'city', 'state', 'zip'],
        order: ['street', 'city', 'state', 'zip'],
      },
      academicYear: { startMonth: 9 },
      identifiers: { national: '^\\d{9}$', student: '^\\d{6}$' },
    };

    const resolved = resolveRegionConfig(REGION_BD_BN, tenantRegion);

    expect(resolved.locale).toBe('en-US');
    expect(resolved.currency).toEqual(tenantRegion.currency);
    expect(resolved.date).toEqual(tenantRegion.date);
    expect(resolved.phone.country).toBe('1');
    expect(resolved.phone.pattern).toBeInstanceOf(RegExp);
    expect(resolved.phone.pattern.test('2125551234')).toBe(true);
    expect(resolved.address).toEqual(tenantRegion.address);
    expect(resolved.academicYear).toEqual({ startMonth: 9 });
    expect(resolved.identifiers).toEqual(tenantRegion.identifiers);
  });

  it('falls back per field, not all-or-nothing — a partial override keeps the rest of the default', () => {
    const resolved = resolveRegionConfig(REGION_BD_BN, {
      currency: {
        code: 'BDT',
        symbol: '৳',
        position: 'prefix',
        decimals: 2,
        grouping: 'lakh-crore',
      },
      academicYear: { startMonth: 7 },
    });

    // Overridden fields win.
    expect(resolved.academicYear).toEqual({ startMonth: 7 });
    // Everything else falls through to the default, field by field.
    expect(resolved.locale).toBe(REGION_BD_BN.locale);
    expect(resolved.date).toEqual(REGION_BD_BN.date);
    expect(resolved.phone).toEqual(REGION_BD_BN.phone);
    expect(resolved.address).toEqual(REGION_BD_BN.address);
    expect(resolved.identifiers).toEqual(REGION_BD_BN.identifiers);
    expect(resolved.timezone).toBe(REGION_BD_BN.timezone);
  });

  it('falls back within a nested group too — one currency field overridden, siblings keep the default', () => {
    const resolved = resolveRegionConfig(REGION_BD_BN, {
      currency: { ...REGION_BD_BN.currency, code: 'USD' },
    });

    expect(resolved.currency.code).toBe('USD');
    expect(resolved.currency.symbol).toBe(REGION_BD_BN.currency.symbol);
    expect(resolved.currency.grouping).toBe(REGION_BD_BN.currency.grouping);
  });

  it('two tenants with different currency settings resolve to genuinely different configs', () => {
    const tenantA = resolveRegionConfig(REGION_BD_EN, {
      currency: {
        code: 'BDT',
        symbol: '৳',
        position: 'prefix',
        decimals: 2,
        grouping: 'lakh-crore',
      },
    });
    const tenantB = resolveRegionConfig(REGION_BD_EN, {
      currency: { code: 'USD', symbol: '$', position: 'prefix', decimals: 2, grouping: 'thousand' },
    });

    expect(tenantA.currency.code).toBe('BDT');
    expect(tenantB.currency.code).toBe('USD');
    expect(tenantA.currency.grouping).not.toBe(tenantB.currency.grouping);
  });

  it('compiles a valid regex source string into a RegExp', () => {
    const resolved = resolveRegionConfig(REGION_BD_BN, {
      phone: {
        country: REGION_BD_BN.phone.country,
        example: REGION_BD_BN.phone.example,
        displayFormat: REGION_BD_BN.phone.displayFormat,
        pattern: '^9\\d{8}$',
      },
    });

    expect(resolved.phone.pattern.test('912345678')).toBe(true);
    expect(resolved.phone.pattern.test('112345678')).toBe(false);
  });

  it('falls back to the default pattern instead of throwing on an invalid regex source', () => {
    const resolved = resolveRegionConfig(REGION_BD_BN, {
      phone: {
        country: REGION_BD_BN.phone.country,
        example: REGION_BD_BN.phone.example,
        displayFormat: REGION_BD_BN.phone.displayFormat,
        pattern: '(unterminated[',
      },
    });

    expect(resolved.phone.pattern).toBe(REGION_BD_BN.phone.pattern);
  });
});
