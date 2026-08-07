import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { mergeTenantSettings, toPlainSettingsPatch } from './tenant-settings-merge.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from './tenant-settings-defaults';

function toPatch(plain: Record<string, unknown>): Record<string, unknown> {
  return toPlainSettingsPatch(plainToInstance(TenantSettingsDto, plain));
}

describe('mergeTenantSettings', () => {
  it('starts from an empty object when nothing was stored yet', () => {
    const patch = toPatch({ version: 1, region: DEFAULT_REGION_SETTINGS });

    const merged = mergeTenantSettings(null, patch);

    expect(merged.version).toBe(1);
    expect(merged.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(merged.communications).toBeUndefined();
  });

  it('replaces region wholesale but leaves communications untouched', () => {
    const existing = {
      version: 1,
      region: DEFAULT_REGION_SETTINGS,
      communications: { sms: { provider: 'greenweb', greenweb: { apiKey: 'enc:old' } } },
    };
    const patch = toPatch({ version: 1, region: { ...DEFAULT_REGION_SETTINGS, locale: 'en-BD' } });

    const merged = mergeTenantSettings(existing, patch);

    expect((merged.region as { locale: string }).locale).toBe('en-BD');
    expect(merged.communications).toEqual(existing.communications);
  });

  it('merges communications one medium at a time, preserving siblings', () => {
    const existing = {
      version: 1,
      communications: {
        sms: { provider: 'greenweb', greenweb: { apiKey: 'enc:old-sms' } },
        email: {
          host: 'smtp.old.example',
          port: 587,
          user: 'a',
          from: 'a@x.com',
          password: 'enc:old-email',
        },
      },
    };
    const patch = toPatch({
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '999', accessToken: 'enc:new-wa' },
      },
    });

    const merged = mergeTenantSettings(existing, patch);
    const communications = merged.communications as Record<string, unknown>;

    expect(communications.sms).toEqual(existing.communications.sms);
    expect(communications.email).toEqual(existing.communications.email);
    expect(communications.whatsapp).toEqual({ phoneNumberId: '999', accessToken: 'enc:new-wa' });
  });

  it('leaves region untouched when the patch omits it', () => {
    const existing = { version: 1, region: DEFAULT_REGION_SETTINGS };
    const patch = toPatch({ version: 1 });

    const merged = mergeTenantSettings(existing, patch);

    expect(merged.region).toEqual(DEFAULT_REGION_SETTINGS);
  });
});
