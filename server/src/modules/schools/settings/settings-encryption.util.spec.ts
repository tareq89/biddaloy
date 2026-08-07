import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';
import { encryptSecretFields, decryptSecretFields } from './settings-encryption.util';

function service(): EncryptionService {
  return new EncryptionService(randomBytes(32));
}

describe('encryptSecretFields', () => {
  it('encrypts every secret field present, leaving non-secret fields untouched', () => {
    const encryption = service();
    const settings = {
      version: 1,
      communications: {
        sms: { provider: 'greenweb', greenweb: { apiKey: 'sms-key' } },
        whatsapp: { phoneNumberId: '123', accessToken: 'wa-token' },
        email: { host: 'smtp.example.com', port: 587, user: 'a', from: 'a@x.com', password: 'pw' },
      },
    };

    const encrypted = encryptSecretFields(settings, encryption);
    const communications = encrypted.communications as any;

    expect(communications.sms.provider).toBe('greenweb');
    expect(communications.sms.greenweb.apiKey).toMatch(/^gcmv1:/);
    expect(communications.whatsapp.phoneNumberId).toBe('123');
    expect(communications.whatsapp.accessToken).toMatch(/^gcmv1:/);
    expect(communications.email.host).toBe('smtp.example.com');
    expect(communications.email.password).toMatch(/^gcmv1:/);
  });

  it('does not mutate the object it was given', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: 'wa-token' } } };

    encryptSecretFields(settings, encryption);

    expect((settings.communications.whatsapp as any).accessToken).toBe('wa-token');
  });

  it('skips a secret path that is absent, rather than throwing', () => {
    const encryption = service();
    const settings = { version: 1, communications: { sms: { provider: 'greenweb' } } };

    expect(() => encryptSecretFields(settings, encryption)).not.toThrow();
  });

  it('skips a secret field that is an empty string, leaving it as-is', () => {
    const encryption = service();
    const settings = { communications: { whatsapp: { accessToken: '' } } };

    const encrypted = encryptSecretFields(settings, encryption);

    expect((encrypted.communications as any).whatsapp.accessToken).toBe('');
  });
});

describe('decryptSecretFields', () => {
  it('reverses encryptSecretFields exactly', () => {
    const encryption = service();
    const original = {
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: 'wa-token' },
        messenger: { pageId: 'p1', accessToken: 'msg-token' },
      },
    };

    const roundTripped = decryptSecretFields(encryptSecretFields(original, encryption), encryption);

    expect(roundTripped).toEqual(original);
  });
});
