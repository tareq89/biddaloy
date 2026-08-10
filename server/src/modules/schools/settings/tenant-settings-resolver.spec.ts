import { describe, it, expect } from 'vitest';
import { resolveTenantSettings } from './tenant-settings-resolver';
import { DEFAULT_REGION_SETTINGS } from './tenant-settings-defaults';

describe('resolveTenantSettings', () => {
  it('resolves to full defaults for a null settings blob', () => {
    const resolved = resolveTenantSettings(null);

    expect(resolved.version).toBe(1);
    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.communications).toBeUndefined();
  });

  it('resolves to full defaults for an empty settings blob', () => {
    const resolved = resolveTenantSettings({});

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
  });

  it('falls back to default region when only communications is configured', () => {
    const resolved = resolveTenantSettings({
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' } },
    });

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.communications).toEqual({
      whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' },
    });
  });

  it('keeps a stored region rather than falling back when one is present', () => {
    const customRegion = { ...DEFAULT_REGION_SETTINGS, locale: 'en-BD', timezone: 'Asia/Dhaka' };

    const resolved = resolveTenantSettings({ region: customRegion });

    expect(resolved.region).toEqual(customRegion);
    expect(resolved.communications).toBeUndefined();
  });

  it('always stamps the current schema version regardless of what was stored', () => {
    const resolved = resolveTenantSettings({ version: 999 });

    expect(resolved.version).toBe(1);
  });

  // The stored blob isn't re-validated on read — it can predate a schema
  // change, be hand-edited, or come back from a backup — so a section
  // being present doesn't make it complete. Callers rely on every region
  // field existing; resolving per-section rather than per-field would
  // hand them a region missing `currency`, `date`, and the rest.
  describe('partial and malformed stored regions', () => {
    it('fills in every field a partially-stored region omits', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD' } });

      expect(resolved.region).toEqual({ ...DEFAULT_REGION_SETTINGS, locale: 'en-BD' });
    });

    it('merges inside a nested group, not just at the top level', () => {
      const resolved = resolveTenantSettings({ region: { currency: { code: 'USD' } } });

      expect(resolved.region?.currency).toEqual({
        ...DEFAULT_REGION_SETTINGS.currency,
        code: 'USD',
      });
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('falls back per field on a wrong-typed value, keeping its siblings', () => {
      const resolved = resolveTenantSettings({
        region: { locale: 42, timezone: 'Asia/Dhaka' },
      });

      expect(resolved.region?.locale).toBe(DEFAULT_REGION_SETTINGS.locale);
      expect(resolved.region?.timezone).toBe('Asia/Dhaka');
    });

    it('falls back to the default group when a nested group is not an object', () => {
      const resolved = resolveTenantSettings({ region: { currency: null, date: 'nonsense' } });

      expect(resolved.region?.currency).toEqual(DEFAULT_REGION_SETTINGS.currency);
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('replaces an array wholesale rather than merging it element-wise', () => {
      const resolved = resolveTenantSettings({
        region: { address: { fields: ['street'], order: ['street'] } },
      });

      expect(resolved.region?.address).toEqual({ fields: ['street'], order: ['street'] });
    });

    it('drops a stored key the current schema no longer knows about', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD', legacyField: 'x' } });

      expect(resolved.region).not.toHaveProperty('legacyField');
    });

    it('falls back to defaults when region itself is not an object', () => {
      expect(resolveTenantSettings({ region: 'nonsense' }).region).toEqual(DEFAULT_REGION_SETTINGS);
      expect(resolveTenantSettings({ region: null }).region).toEqual(DEFAULT_REGION_SETTINGS);
    });

    it('omits communications when it is stored as something other than an object', () => {
      expect(resolveTenantSettings({ communications: 'nonsense' }).communications).toBeUndefined();
    });
  });
});
