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

  describe('field-level merge within a medium — #8.7.9 PATCH contract', () => {
    it('omitting a secret field from the patch leaves the stored value unchanged', () => {
      const existing = {
        version: 1,
        communications: {
          whatsapp: { phoneNumberId: '111', accessToken: 'enc:old-token' },
        },
      };
      // Patch touches only phoneNumberId — accessToken is genuinely
      // absent from the payload, not merely undefined-in-JS.
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '222' } },
      });

      const merged = mergeTenantSettings(existing, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp.phoneNumberId).toBe('222');
      expect(whatsapp.accessToken).toBe('enc:old-token');
    });

    it('an explicit null clears a secret field rather than leaving it unchanged', () => {
      const existing = {
        version: 1,
        communications: {
          whatsapp: { phoneNumberId: '111', accessToken: 'enc:old-token' },
        },
      };
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '111', accessToken: null } },
      });

      const merged = mergeTenantSettings(existing, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp.accessToken).toBeNull();
    });

    it('merges two levels deep — sms.mimsms.apiKey omitted preserves it while senderId updates', () => {
      const existing = {
        version: 1,
        communications: {
          sms: {
            provider: 'mimsms',
            mimsms: { apiKey: 'enc:old-key', senderId: 'OLD' },
          },
        },
      };
      const patch = toPatch({
        version: 1,
        communications: {
          sms: { provider: 'mimsms', mimsms: { senderId: 'NEW' } },
        },
      });

      const merged = mergeTenantSettings(existing, patch);
      const mimsms = (
        (merged.communications as Record<string, unknown>).sms as Record<string, unknown>
      ).mimsms as Record<string, unknown>;

      expect(mimsms.senderId).toBe('NEW');
      expect(mimsms.apiKey).toBe('enc:old-key');
    });

    it('a fresh field value on a never-configured medium still requires an unset field to be genuinely absent from the patch', () => {
      // No `existing` at all — proves the merge doesn't crash reaching
      // into a medium that was never configured before.
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '111' } },
      });

      const merged = mergeTenantSettings(null, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp.phoneNumberId).toBe('111');
      expect('accessToken' in whatsapp).toBe(false);
    });
  });
});
