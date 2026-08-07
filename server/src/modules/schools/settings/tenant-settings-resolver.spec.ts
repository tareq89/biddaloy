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
});
