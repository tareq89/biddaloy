import { describe, it, expect } from 'vitest';
import { pickPatchShape, redactSecretPaths } from './settings-audit-redact.util';

describe('pickPatchShape', () => {
  it('picks only the keys the patch touches, at every depth', () => {
    const existing = {
      version: 1,
      communications: {
        sms: { provider: 'greenweb' },
        whatsapp: { phoneNumberId: 'old-id', accessToken: 'old-token' },
      },
    };
    const patch = {
      version: 1,
      communications: { whatsapp: { phoneNumberId: 'new-id' } },
    };

    expect(pickPatchShape(existing, patch)).toEqual({
      version: 1,
      communications: { whatsapp: { phoneNumberId: 'old-id' } },
    });
  });

  it('leaves the whole section undefined when the patch names one that never existed before', () => {
    const existing = { version: 1 };
    const patch = { version: 1, communications: { whatsapp: { phoneNumberId: 'new-id' } } };

    expect(pickPatchShape(existing, patch)).toEqual({
      version: 1,
      communications: undefined,
    });
  });
});

describe('redactSecretPaths', () => {
  it('masks every @Secret()-marked field present, leaving other fields untouched', () => {
    const settings = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: 'super-secret' },
        email: { host: 'smtp.example.com', password: 'hunter2' },
        sms: { provider: 'greenweb', greenweb: { apiKey: 'key-1' } },
      },
    };

    const redacted = redactSecretPaths(settings);

    expect(redacted.communications).toMatchObject({
      whatsapp: { phoneNumberId: '123', accessToken: '[REDACTED]' },
      email: { host: 'smtp.example.com', password: '[REDACTED]' },
      sms: { provider: 'greenweb', greenweb: { apiKey: '[REDACTED]' } },
    });
    expect(JSON.stringify(redacted)).not.toContain('super-secret');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
    expect(JSON.stringify(redacted)).not.toContain('key-1');
  });

  it('masks a secret explicitly cleared to null the same as a real value', () => {
    const settings = { communications: { whatsapp: { accessToken: null } } };

    const redacted = redactSecretPaths(settings);

    expect((redacted.communications as any).whatsapp.accessToken).toBe('[REDACTED]');
  });

  it('leaves an absent secret path untouched rather than inventing a key', () => {
    const settings = { version: 1 };

    expect(redactSecretPaths(settings)).toEqual({ version: 1 });
  });

  it('does not mutate the input object', () => {
    const settings = { communications: { whatsapp: { accessToken: 'super-secret' } } };

    redactSecretPaths(settings);

    expect(settings.communications.whatsapp.accessToken).toBe('super-secret');
  });
});
